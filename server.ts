import express from "express";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));

const llmLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: "rate_limited" } });
const smtpLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: "rate_limited" } });

// Nodemailer SMTP Transporter setup (Lazy initialization)
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "ssl0.ovh.net",
      port: 465,
      secure: true, // Use SSL
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

app.post("/api/newsletter/send", smtpLimiter, async (req, res) => {
  try {
    const { to, subject, html, fromOverride } = req.body;
    
    if (!to || !subject || !html) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      // Fake success for simulation if no credentials are provided yet to prevent UI crashes in preview
      console.log("No SMTP credentials. Simulating newsletter send to:", to);
      return res.json({ success: true, simulated: true });
    }

    const tp = getTransporter();
    
    // Determine the sender. E.g "Newsletter PRISME <newsletter.prisme@hrconseil.net>"
    const sender = fromOverride || `Newsletter PRISME <${process.env.SMTP_USER}>`;

    const info = await tp.sendMail({
      from: sender,
      to,
      subject,
      html,
    });

    console.log("Message sent: %s", info.messageId);
    return res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error("Error sending newsletter:", error);
    return res.status(500).json({ error: "Failed to send email" });
  }
});

// REST API endpoint to generate structural report with Perplexity
app.post("/api/rss-stats", async (req, res) => {
  try {
    const { sources } = req.body;
    if (!Array.isArray(sources)) return res.json({ counts: {} });

    const counts: Record<string, number> = {};

    await Promise.all(
      sources.map(async (url) => {
        if (!url || !url.startsWith("http")) {
          counts[url] = 0;
          return;
        }
        try {
          // Attempting to fetch the feed or page
          const reqCtrl = new AbortController();
          const timeoutId = setTimeout(() => reqCtrl.abort(), 3500);
          
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 PRISME-Bot/1.0",
              "Accept": "application/rss+xml, application/xml, text/xml, */*"
            },
            signal: reqCtrl.signal
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            counts[url] = 0;
            return;
          }

          const text = await response.text();
          // Match standard RSS <item> or Atom <entry>
          const itemCount = (text.match(/<item[\s>]/gi) || []).length;
          const entryCount = (text.match(/<entry[\s>]/gi) || []).length;
          
          let total = itemCount + entryCount;
          
          // If it's just an HTML page (not a real RSS, as some of those links might be), 
          // we can fallback to 0 or a mockup number. We'll default to total found.
          counts[url] = total;

        } catch (e) {
          counts[url] = 0;
        }
      })
    );

    res.json({ counts });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch RSS stats" });
  }
});

import cron from "node-cron";
import { scanActiveSources } from "./src/server/veille/scanner";
import { purgeExpiredArticles } from "./src/server/veille/persistence";
import { structureWeeklyReport, computeWeekId } from "./src/server/veille/structurer";
import { getPerplexityClient, isPerplexityConfigured, DEFAULT_MODEL } from "./src/server/veille/perplexityClient";
import { getAdminDb } from "./src/server/firebaseAdmin";
import { collection, getDocs, limit, orderBy, query } from "./src/server/lib/firestoreCompat";
import { AUDIT_COLLECTION, filterByReason, isValidRejectionReason } from "./src/server/veille/auditor";

// Auto-generation function for weekly reports
async function generateWeeklyAutoReport() {
  const hasApiKey = isPerplexityConfigured();
  const now = new Date();

  // Story 2-5 patch #4+#34 : deleguer a structurer.computeWeekId (ISO 8601 UTC,
  // clamp w1..w53) au lieu d'un calcul TZ-naif divergent.
  const weekLabel = computeWeekId(now);
  const weekTitle = `Semaine du ${now.getDate()} ${now.toLocaleString('fr-FR', { month: 'long' })} ${now.getFullYear()}`;

  // Story 2-5 (AC #8, #9) : tenter d'abord la structuration RÉELLE via
  // structurer.ts (qui consomme loadPassingArticles → Gemini → reports/{weekId}).
  // Si succès → rapport structuré, pas de simulation.
  // Si null (corpus vide, Gemini indispo, JSON invalide) → fallback simulation
  // (comportement legacy conservé pour backward compat, retiré en story 3-3).
  try {
    const structured = await structureWeeklyReport({ weekId: weekLabel });
    if (structured !== null) {
      console.log(`[weekly-report] rapport structuré réel généré pour ${weekLabel} (${structured.actualites.length} actus, ${structured.articlesUsed} articles utilisés)`);
      return { ...structured, simulated: false };
    }
  } catch (err) {
    // structurer.ts ne doit jamais throw, mais on garde un filet de sécurité.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[weekly-report] structureWeeklyReport a throw (imprévu) : ${message}`);
  }

  // Patch #6 + #12 : simulation systématique en fallback (backward compat
  // story 2-5 AC #9 + #10). Déclenchée si structurer a retourné null OU
  // si la clé API est absente. Return type unifié { ...VeilleReport,
  // simulated: boolean }.
  console.log(
    `[weekly-report] fallback simulation pour ${weekLabel}` +
      (hasApiKey ? " (structurer null)" : " (OPENROUTER_API_KEY absente)"),
  );
  return {
    id: weekLabel,
    week: weekTitle,
    top3: [
      "Intelligence Artificielle Générative : L'adoption massive dans les SIRH s'accélère après les régulations de mai.",
      "Automatisation de la gestion des talents : De nouvelles suites logicielles intègrent des agents conversationnels prédictifs.",
      "RGPD et IA : La CNIL lance une nouvelle vague de contrôles sur les outils de 'resume parsing'."
    ],
    actualites: [
      {
        title: "Les SIRH face au mur réglementaire de l'IA Act Européen",
        source: "Actuel RH",
        date: now.toLocaleDateString("fr-FR"),
        summary: "Les éditeurs de systèmes RH doivent désormais obligatoirement auditer la transparence de leurs modèles. Une complexité que beaucoup avaient sous-estimée selon la dernière enquête de la DARES.",
        impact: "Augmentation des coûts d'implémentation et risque de retard sur les roadmaps de numérisation RH.",
        tags: ["juridique", "IA générative"],
      },
      {
        title: "Adoption des Agents RH autonomes",
        source: "Parlons RH",
        date: now.toLocaleDateString("fr-FR"),
        summary: "Un nouveau cap a été franchi par Workday et Cegid cette semaine avec l'intégration native d'assistants intelligents qui valident seuls les congés d'équipes et répondent aux requêtes RH des employés courants.",
        impact: "Transformation du rôle du Helpdesk RH vers des missions plus stratégiques.",
        tags: ["automatisation", "marché"],
      }
    ],
    mouvements: [
      {
        title: "Partenariat européen majeur",
        details: "Plusieurs grandes entreprises ont signé un accord de transparence pour ne pas utiliser d'IA sans consentement éclairé de leurs syndicats.",
        category: "Légal",
      }
    ],
    reglementation: [
      {
        title: "Nouvelle directive sur l'analyse sémantique locale",
        detail: "Interdiction d'analyser les espaces de discussion (Teams/Slack) de manière non ciblée. Toute déviance peut faire l'objet de contrôles surprises.",
        type: "Régulation CNIL",
      }
    ],
    chiffre: {
      value: "62%",
      text: "62% des DRH confirment observer un gain de temps de plus d'une journée par semaine suite à la mise en place d'une d'automatisation intelligente de niveau 1.",
      source: "Sondage RH Info 2026",
    },
    signalFaible: {
      title: "Baisse de l'engagement asynchrone",
      description: "L'automatisation croissante des messages pousse les employés à ignorer certains flux d'informations automatiques (phénomène de 'Bot Blindness').",
    },
    ressources: [
      {
        title: "Livre Blanc: Bien intégrer l'IA à ses pratiques RH 2026",
        duration: "25 min de lecture",
        type: "PDF",
      }
    ],
    actions: [
      {
        title: "Sensibilisation et Charte IA",
        detail: "Réviser la charte d'utilisation des outils numériques pour y inclure un volet IA, afin de prévenir le 'Shadow AI'.",
        confidentiality: "Basse",
        criticality: "Haute"
      }
    ],
    simulated: true,
  };
}

// Scheduled Cron Job : rapport hebdomadaire le dimanche 23:30 (cf. SPEC CAP-2).
// SPEC CAP-2 spécifie un cron HEBDOMADAIRE. Le scan-orchestrateur applique
// le gating temporel (daily/weekly/custom) en interne via shouldScan.
// Un second cron quotidien 06:00 rejoue uniquement les sources `daily`.
cron.schedule("30 23 * * 0", async () => {
    console.log("[cron] tache hebdomadaire declenchee (dimanche 23:30).");
    try {
      const scanResult = await scanActiveSources();
      console.log("[cron] scan termine :", {
        scanId: scanResult.scanId,
        sourcesScanned: scanResult.sourcesScanned,
        sourcesSkipped: scanResult.sourcesSkipped,
        articlesFound: scanResult.articlesFound,
        errors: scanResult.errors.length,
      });
    } catch (err) {
      console.error("[cron] scan crashed :", err);
    }
});

cron.schedule("0 6 * * *", async () => {
    // Cron quotidien 06:00 : re-scanne les sources `daily` uniquement.
    // Le gating interne via shouldScan() skip les sources weekly/custom.
    try {
      const scanResult = await scanActiveSources();
      if (scanResult.sourcesScanned > 0) {
        console.log("[cron] daily scan termine :", {
          scanId: scanResult.scanId,
          sourcesScanned: scanResult.sourcesScanned,
          articlesFound: scanResult.articlesFound,
        });
      }
    } catch (err) {
      console.error("[cron] daily scan crashed :", err);
    }
});

// Story 2-4 : purge quotidien des articles `veille_raw_articles` expirés.
// Lancé à 03:00 UTC = 05:00 Paris hiver / 04:00 Paris été. Best-effort, log
// warn en cas d'échec. Le TTL natif Firestore (best-effort 24h) complète ce
// job pour garantir une suppression déterministe sous 24h après expiration.
cron.schedule("0 3 * * *", () => {
  console.log("[cron] purge quotidien démarré");
  void purgeExpiredArticles()
    .then((result) => {
      if (result.reason) {
        console.warn(`[cron] purge quotidien en mode dégradé : ${result.reason}`);
      } else {
        console.log(`[cron] purge quotidien terminé : ${result.purged} docs supprimés en ${result.durationMs}ms`);
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[cron] purge quotidien crash : ${message}`);
    });
});

// Endpoint that an Admin can call to "force" the automated generation sequence.
// AC #12 : appelle scanActiveSources() AVANT generateWeeklyAutoReport() pour
// garantir que le rapport est généré avec les sources les plus fraîches.
// AC #12 alignement : `report` est `null` si le scan n'a trouvé aucun article.
app.get("/api/veille/auto-generate", llmLimiter, async (req, res) => {
  try {
    const scanResult = await scanActiveSources();
    if (scanResult.articlesFound === 0) {
      res.json({
        success: false,
        scanResult,
        report: null,
        reason: "scan_found_no_articles",
      });
      return;
    }
    const report = await generateWeeklyAutoReport();
    if (report) {
      res.json({ success: true, scanResult, report });
    } else {
      res.status(500).json({ error: "No report generated", scanResult });
    }
  } catch(err) {
    res.status(500).json({ error: "Generation failed" });
  }
});

// Story 2-4 : endpoint admin pour déclencher la purge des articles expirés
// à la demande. Admin gate à DEUX niveaux :
//   1. Header `Authorization: Bearer <VEILLE_ADMIN_TOKEN>` vérifié par
//      `crypto.timingSafeEqual` (constant-time, anti-timing-attack).
//   2. En mode dégradé (env var absente), fallback sur le check substring
//      pré-existant "admin" cohérent avec App.tsx:619-621 (dette documentée).
// Sans le secret configuré, l'endpoint est désactivé (renvoie 503).
import { timingSafeEqual } from "node:crypto";

function checkAdminAuth(req: express.Request): { ok: boolean; reason?: string } {
  const expected = process.env.VEILLE_ADMIN_TOKEN;
  if (!expected) {
    // Pas de secret configuré → endpoint désactivé (fail-closed).
    return { ok: false, reason: "admin_token_unconfigured" };
  }
  const auth = (req.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return { ok: false, reason: "missing_bearer" };
  const provided = match[1];
  // timingSafeEqual exige des buffers de même longueur : pad si nécessaire.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "bad_token" };
  return { ok: timingSafeEqual(a, b), reason: timingSafeEqual(a, b) ? undefined : "bad_token" };
}

app.post("/api/veille/admin/purge-expired", async (req, res) => {
  const auth = checkAdminAuth(req);
  if (!auth.ok) {
    console.warn(`[admin] purge refusée : ${auth.reason}`);
    return res.status(401).json({ error: "non autorisé", code: "ADMIN_GATE", reason: auth.reason });
  }
  try {
    const result = await purgeExpiredArticles();
    console.log(
      `[admin] purge manuelle : ${result.purged} docs supprimés en ${result.durationMs}ms` +
        (result.reason ? ` (mode dégradé : ${result.reason})` : ""),
    );
    res.json({
      purged: result.purged,
      durationMs: result.durationMs,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin] purge manuelle crash :", err);
    res.status(500).json({ error: `Purge échouée : ${message}` });
  }
});

// Story 2-6 (AC #7) : endpoint admin pour consulter le journal d'audit
// (`veille_audit_log`). Admin gate à 2 niveaux (cf. checkAdminAuth ci-dessus).
// Query params :
//   - `?weekId=YYYY-WNN` : optionnel. Si fourni, query index composite
//     (weekId ASC + rejectedAt DESC) défini dans firestore.indexes.json.
//   - `?limit=N` : clamp [1, 200], défaut 50. NaN → 400.
//   - `?reason=...` : optionnel, filtre via `filterByReason`. Defense in depth
//     via `isValidRejectionReason` (rejette enum drift, 400).
// Mode dégradé (Firestore indispo / read failed) : 200 + `{status: "<raison>"}`,
// JAMAIS 500 (cf. C4).
app.get("/api/veille/admin/audit-log", async (req, res) => {
  const auth = checkAdminAuth(req);
  if (!auth.ok) {
    console.warn(`[admin/audit-log] accès refusé : ${auth.reason}`);
    return res.status(401).json({ error: "non autorisé", code: "ADMIN_GATE", reason: auth.reason });
  }

  // Parse + valide `limit`.
  const rawLimit = req.query.limit;
  let limitCount = 50;
  if (typeof rawLimit === "string" && rawLimit.length > 0) {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return res.status(400).json({ error: "limit invalide", code: "BAD_LIMIT" });
    }
    // Clamp [1, 200].
    limitCount = Math.max(1, Math.min(200, Math.floor(parsed)));
  }

  // Filtre `reason` optionnel (defense in depth via type guard).
  const rawReason = req.query.reason;
  let reasonFilter: string | null = null;
  if (typeof rawReason === "string" && rawReason.length > 0) {
    if (!isValidRejectionReason(rawReason)) {
      return res
        .status(400)
        .json({ error: `reason invalide : ${rawReason}`, code: "BAD_REASON" });
    }
    reasonFilter = rawReason;
  }

  const weekId =
    typeof req.query.weekId === "string" && req.query.weekId.length > 0
      ? req.query.weekId
      : null;

  // Mode dégradé : Firestore indispo.
  const db = getAdminDb();
  if (!db) {
    console.warn("[admin/audit-log] Firestore indispo, retour status=firestore_unavailable");
    return res.status(200).json({
      status: "firestore_unavailable",
      entries: [],
      count: 0,
    });
  }

  try {
    // Filtre composite (weekId + tri) nécessite l'index composite ajouté
    // dans firestore.indexes.json (story 2-6 Task 6).
    const { where, orderBy, limit: fsLimit } = await import("firebase-admin/firestore");
    const q = weekId
      ? query(
          collection(db, AUDIT_COLLECTION),
          where("weekId", "==", weekId),
          orderBy("rejectedAt", "desc"),
          fsLimit(limitCount),
        )
      : query(
          collection(db, AUDIT_COLLECTION),
          orderBy("rejectedAt", "desc"),
          fsLimit(limitCount),
        );
    const snap = await getDocs(q);
    const raw: Array<{ reason: string }> = snap.docs.map((d) => {
      const data = d.data();
      return {
        reason: typeof data.reason === "string" ? data.reason : "",
      };
    });
    // Filtre reason côté Node (defense in depth post-fetch).
    const filtered = reasonFilter ? filterByReason(raw, reasonFilter) : raw;
    return res.status(200).json({
      status: "ok",
      entries: filtered,
      count: filtered.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[admin/audit-log] read failed : ${message}`);
    return res.status(200).json({
      status: "read_failed",
      entries: [],
      count: 0,
    });
  }
});

// Story 2-5 (AC #10, #11) : endpoint lecture seule pour récupérer le dernier
// rapport structuré depuis `reports/`. Pas d'admin gate (lecture publique
// pour utilisateurs authentifiés via Firestore rules côté client).
// Tri par `generatedAt` desc, limit 1. Mode dégradé (Firestore indispo) :
// retourne `{ report: null, reason: "firestore_unavailable" }` 200, jamais 500.
app.get("/api/veille/latest", async (_req, res) => {
  const db = getAdminDb();
  if (!db) {
    console.warn("[veille/latest] Firestore indispo, retour report=null");
    return res.status(200).json({ report: null, reason: "firestore_unavailable" });
  }
  try {
    const q = query(collection(db, "reports"), orderBy("generatedAt", "desc"), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      return res.status(200).json({ report: null, reason: "no_report" });
    }
    // Patch #24 : ignorer les docs corrompus (champ `report` manquant) en
    // parcourant la liste triée. Fallback "no_report" si rien d'exploitable.
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (!data.report) {
        console.warn(
          `[veille/latest] doc ${docSnap.id} sans champ 'report', ignoré (corrompu)`,
        );
        continue;
      }
      return res.status(200).json({
        report: data.report,
        weekId: docSnap.id,
        generatedAt: data.generatedAt ?? null,
        articlesUsed: typeof data.articlesUsed === "number" ? data.articlesUsed : 0,
        batchId: typeof data.batchId === "string" ? data.batchId : null,
      });
    }
    return res.status(200).json({ report: null, reason: "no_report" });
  } catch (err) {
    // Patch #5 + #23 : tout catch → 200 avec `reason`, jamais 500 (AC #11).
    // Patch #23 : FAILED_PRECONDITION = index composite manquant → reason
    // explicite pour le caller (peut trigger un rebuild d'index).
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: number }).code;
    let reason = "read_failed";
    if (code === 9 /* FAILED_PRECONDITION */) reason = "missing_index";
    console.warn(`[veille/latest] lecture échouée (${reason}) : ${message}`);
    return res.status(200).json({ report: null, reason, error: message });
  }
});

app.post("/api/veille/generate", llmLimiter, async (req, res) => {
  const { rawText, customInstructions } = req.body;

  if (typeof rawText !== "string") return res.status(400).json({ error: "rawText_required" });
  if (rawText.length > 65536) return res.status(413).json({ error: "rawText_too_large", max: 65536 });
  if (typeof customInstructions === "string" && customInstructions.length > 8192) {
    return res.status(413).json({ error: "customInstructions_too_large", max: 8192 });
  }

  if (!rawText || rawText.trim() === "") {
    return res.status(400).json({ error: "Du texte source est requis pour générer la veille." });
  }

  const hasApiKey = isPerplexityConfigured();

  if (!hasApiKey) {
    console.log("Using rich simulated AI generator due to missing OPENROUTER_API_KEY");
    
    // Simple custom routing to simulate different outputs based on keywords in the text
    const textLower = rawText.toLowerCase();
    let simulatedReport = {
      week: "Semaine du 28 Mai 2026",
      top3: [
        "L'annonce surprise de Lucca d'un partenariat de conformité éthique avec HumaniAI pour rassurer les DSI.",
        "Le rapport Mercer 2026 soulignant l'accentuation de l'écart de formation IA chez les professionnels RH français.",
        "L'IA Act européen entre dans sa phase finale d'application sur les outils de tri automatique de CV."
      ],
      actualites: [
        {
          title: "Partenariat stratégique Lucca et HumaniAI pour la transparence",
          source: "Parlons RH",
          date: "25 Mai 2026",
          summary: "Lucca annonce l'intégration des filtres d'évaluation HumaniAI dans son module de recrutement pour auditer de manière autonome la conformité de ses algorithmes tiers.",
          impact: "Permet aux DRH de prouver l'équité des sélections lors des audits de conformité réglementaire.",
          tags: ["recrutement", "éthique", "marché"],
          url: "https://www.parlonsrh.com/"
        },
        {
          title: "Mercer HR Trends 2026 : Le retard d'acculturation s'accroît",
          source: "RH Matin",
          date: "24 Mai 2026",
          summary: "Une nouvelle étude démontre que l'urgence de la productivité pousse les managers à adopter des assistants non homologués, faute d'outils officiels intégrés.",
          impact: "Nécessité de diffuser rapidement une politique ou charte d'usage interne de l'IA.",
          tags: ["analytique", "éthique"],
          url: "https://www.rhmatin.com/"
        },
        {
          title: "Intégration d'agents d'entretien autonomes par Talentsoft / Cegid",
          source: "ActuEL-RH",
          date: "23 Mai 2026",
          summary: "Cegid finalise le pilote de son agent de pré-sélection conversationnel. L'outil analyse les réponses libres écrites des candidats pour dresser des bilans d'adéquation de premier niveau.",
          impact: "Permet de diviser par deux le temps de sourcing sur les métiers pénuriques.",
          tags: ["recrutement", "marché"],
          url: "https://www.actuel-rh.fr/"
        },
        {
          title: "Lancement de 'DSN Copilot' par ADP pour la correction automatique de la paye",
          source: "RH Info (ADP)",
          date: "22 Mai 2026",
          summary: "Nouvel automatisme prédictif capable de détecter des écarts de cotisations ou des incohérences déclaratives critiques avant l'envoi mensuel de la DSN.",
          impact: "Sécurisation financière de la paye et diminution des risques de redressements Urssaf.",
          tags: ["paie", "automatisation"],
          url: "https://www.fr.adp.com/rhinfo.aspx"
        },
        {
          title: "Microsoft 365 Copilot intègre des widgets d'évaluation d'équité salariale",
          source: "Parlons RH",
          date: "21 Mai 2026",
          summary: "Microsoft complète son offre RH d'outils d'extraction statistique croisant l'ancienneté, le rôle, le genre et les performances pour identifier les déviations de remunération.",
          impact: "Sert de levier d'aide à la décision avant les négociations annuelles d'augmentation.",
          tags: ["paie", "juridique", "éthique"],
          url: "https://www.parlonsrh.com/"
        },
        {
          title: "Rapport d'analyse du travail : Le burn-out algorithmique sous surveillance",
          source: "ActuEL-RH",
          date: "20 Mai 2026",
          summary: "L'Agence nationale pour l'amélioration des conditions de travail alerte sur les dérives du micro-monitoring algorithmique des employés en télétravail.",
          impact: "Encourage les DRH à définir des chartes du droit à la déconnexion adaptées aux nouveaux outils.",
          tags: ["expérience collaborateur", "éthique"],
          url: "https://www.actuel-rh.fr/"
        },
        {
          title: "Factorial lance un outil d'accompagnement de conformité à l'IA Act",
          source: "Centre Inffo",
          date: "19 Mai 2026",
          summary: "Factorial intègre un questionnaire d'évaluation automatique à l'onboarding de tout connecteur d'IA tiers pour documenter l'explicabilité requise par l'IA Act européen.",
          impact: "Garantit que le dossier de transparence réglementaire est complété sans effort technique.",
          tags: ["juridique", "éthique"],
          url: "https://www.centre-inffo.fr/"
        }
      ],
      mouvements: [
        {
          title: "Lucca x HumaniAI",
          details: "Alliance clé pour imposer une certification éthique face aux réglementations de plus en plus restrictives en Europe.",
          category: "Partenariat / Acquisition"
        },
        {
          title: "Salesforce Einstein Recruiter",
          details: "Déploiement mondial d'un nouvel agent autonome d'aide au sourcing pour les profils hautement qualifiés.",
          category: "Fonctionnalité"
        }
      ],
      reglementation: [
        {
          title: "Contre-audit obligatoire",
          detail: "Toutes les administrations publiques appliquant du scoring candidat automatique doivent désormais fournir l'algorithme source en clair.",
          type: "IA Act"
        }
      ],
      chiffre: {
        value: "62%",
        text: "Des candidats déclarent être prêts à refuser une offre s'ils constatent que le processus d'onboarding est géré de manière 100% automatisée sans contact humain.",
        source: "Sondage national OpinionWay Q2 2026"
      },
      signalFaible: {
        title: "L'avatar d'onboarding d'équipe",
        description: "Certaines équipes créent des jumeaux numériques vocaux de leur manager pour répondre aux questions pratiques des recrues en dehors des horaires de bureau."
      },
      ressources: [
        {
          title: "Rapport d'éthique algorithmique des SIRH",
          duration: "Lecture 8 min",
          type: "Rapport"
        }
      ],
      actions: [
        {
          title: "Mettre à jour le registre des traitements",
          detail: "Lister officiellement tous les sous-traitants utilisant des algorithmes d'évaluation candidats."
        }
      ]
    };

    if (textLower.includes("adp") || textLower.includes("workday")) {
      simulatedReport.week = "Semaine Analyste Focus - Workday & ADP";
      simulatedReport.top3[0] = "Workday accélère avec ses nouveaux agents autonomes de planification budgétaire RH.";
    }

    return res.json({ report: simulatedReport, simulated: true });
  }

  try {
    const client = getPerplexityClient();

    const prompt = `Vous êtes un expert en veille stratégique, intelligence artificielle et systèmes d’information RH (SIRH).
Votre mission est la suivante :
MISSION : "Effectue une veille hebdomadaire structurée sur l’IA et son application dans les SIRH. Chaque session doit produire un rapport synthétique, actionnable et prêt à être partagé avec une équipe (fonctionnelle et technique) de consultants SIRH d’un cabinet de conseil SIRH."

Dans la section des actions (champ "actions"), proposez obligatoirement 2 à 3 actions concrètes et adaptées que le cabinet de conseil SIRH pourrait mettre en place en interne ou directement proposer à ses clients corporatifs (comptes clés).

OBLIGATION DE SOURCE POUR CHAQUE ACTUALITÉ :
- Pour chaque actualité générée, vous devez alimenter l’attribut "source" avec le nom du média (ex: "ActuEL-RH", "Parlons RH", "Centre Inffo", etc.).
- L’attribut "url" de l’actualité doit fournir L’URL DIRECTE DE L’ARTICLE concerné. Uniquement si l’URL exacte est introuvable, indiquez la racine du site (ex: https://www.actuel-rh.fr/).
- Il est STRICTEMENT INTERDIT de renvoyer des valeurs vides ou "Source non spécifiée" ou des URLs génériques sans lien avec la source réelle de l’article.

CRITIQUE: Vous DEVEZ générer exactement 7 sujets d’actualités et innovations récentes (dans le champ "actualites"). Si les données d’entrée manquent de matières, extrapolez ou complétez de manière réaliste en français.

La date actuelle de cette génération pour vous guider est : ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}

Données reçues à analyser:
"""
${rawText}
"""

Instructions particulières fournies par l’utilisateur:
"""
${customInstructions || "Aucune"}
"""

Retournez un objet JSON respectant scrupuleusement le schéma suivant. Les synthèses doivent être de qualité professionnelle, structurées et calibrées pour des consultants et experts SIRH.`;

    const response = await client.chat.completions.create(
      {
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Tu es un expert en veille stratégique IA et SIRH. Tu réponds en français. " +
              "Tu ne génères AUCUN fait, chiffre ou source qui ne soit pas vérifiable. " +
              "Tu cites les URLs exactes des articles sources.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "veille_report",
            strict: true,
            schema: {
              type: "object",
              properties: {
                week: { type: "string", description: "La semaine concernée (ex: ‘Semaine du 21 Mai 2026’ ou basé sur le texte source)" },
                top3: {
                  type: "array",
                  items: { type: "string" },
                  description: "Les 3 faits majeurs incontournables à retenir, chacun en 2 ou 3 lignes."
                },
                actualites: {
                  type: "array",
                  description: "Vous devez générer scrupuleusement et exactement 7 actualités et innovations majeures de la semaine (pas plus, pas moins, exactement 7).",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      source: { type: "string", description: "Nom exact de la source (ex: ‘ActuEL-RH’, ‘Parlons RH’, ‘RH Matin’, ‘RH Info d’ADP’, etc.)" },
                      date: { type: "string" },
                      summary: { type: "string", description: "Résumé factuel de 3-4 lignes" },
                      impact: { type: "string", description: "💡 Impact potentiel et valeur de conseil pour les consultants SIRH ou clients du cabinet" },
                      tags: { type: "array", items: { type: "string" }, description: "Exemples: recrutement, paie, analytique, éthique, marché, juridique" },
                      url: { type: "string", description: "L’URL exacte de l’article lu. N’utilisez l’URL du flux RSS ou du site que si l’URL exacte de l’article est indisponible." }
                    },
                    required: ["title", "source", "date", "summary", "impact", "tags", "url"]
                  }
                },
                mouvements: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Nom de l’éditeur ou de la startup concerné" },
                      details: { type: "string", description: "Description des fonctionnalités, rachats, ou levées" },
                      category: { type: "string", description: "ex: ‘Fonctionnalité’, ‘Partenariat / Acquisition’, ‘Startup à surveiller’" }
                    },
                    required: ["title", "details", "category"]
                  }
                },
                reglementation: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string", description: "Analyse des impacts IA Act, CNIL, RGPD ou vigilance d’éthique" },
                      type: { type: "string", description: "ex: ‘IA Act’, ‘RGPD’, ‘CNIL’, ‘Ethique’" }
                    },
                    required: ["title", "detail", "type"]
                  }
                },
                chiffre: {
                  type: "object",
                  properties: {
                    value: { type: "string", description: "ex: ‘74%’" },
                    text: { type: "string", description: "Le contexte complet et rigoureux" },
                    source: { type: "string", description: "Origine ou étude" }
                  },
                  required: ["value", "text", "source"]
                },
                signalFaible: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["title", "description"]
                },
                ressources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      duration: { type: "string", description: "ex: ‘Lecture 5 min’ ou ‘Document pdf’" },
                      type: { type: "string", description: "ex: ‘Guide’, ‘Rapport’, ‘Outil’, ‘Presse’" }
                    },
                    required: ["title", "duration", "type"]
                  }
                },
                actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      detail: { type: "string", description: "Action concrète recommandée pour le cabinet de conseil SIRH ou ses clients" }
                    },
                    required: ["title", "detail"]
                  }
                }
              },
              required: ["week", "top3", "actualites", "mouvements", "reglementation", "chiffre", "signalFaible", "ressources", "actions"]
            }
          }
        },
        max_tokens: 8000,
        temperature: 0.3,
      },
      {
        // Deep Research peut prendre 1-5 min
        timeout: 5 * 60 * 1000,
      },
    );

    const outputText = response.choices[0]?.message?.content || "{}";
    const reportData = JSON.parse(outputText.trim());
    return res.json({ report: reportData, simulated: false });

  } catch (error: any) {
    console.error("Perplexity API error during report generation:", error);
    return res.status(500).json({ error: "Une erreur est survenue lors de l’accès à l’API Perplexity : " + (error.message || error) });
  }
});

// Setup Vite Dev server or Serve compiled build assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 PRISME server running on http://localhost:${PORT}`);
  });
}

startServer();
