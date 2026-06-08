/**
 * Service de structuration hebdomadaire des articles scorés en 5 catégories
 * métier via Perplexity Sonar Deep Research (story 2-5 — CAP-4 spec veille automatique).
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-4 structuration
 * 5 catégories + C0/C2 anti-hallucination)
 * Cf. _bmad-output/implementation-artifacts/2-5-structuration-en-5-categories-metier-gemini.md
 *
 * Responsabilités :
 * - Charger les `VeilleRawArticle` passants (score >= seuil && !rejected)
 *   via le reader story 2-4 `loadPassingArticles`.
 * - Construire un prompt Perplexity contraignant (C2 : aucune invention de
 *   fait/chiffre/source/URL).
 * - Invoquer Perplexity Sonar Deep Research via OpenRouter avec
 *   `response_format` JSON Schema strict (8 sections `VeilleReport`,
 *   `actualites` max 5).
 * - Valider runtime la réponse JSON (type guard pur, sans zod).
 * - Persister le rapport dans `reports/{weekId}` avec `generatedAt`,
 *   `articlesUsed`, `batchId` (UUID v4 pour audit story 2-6).
 * - Mode dégradé (Firestore indispo OU Perplexity indispo OU corpus vide) :
 *   retourne `null`. Ne throw JAMAIS.
 *
 * Patterns respectés (cf. stories 2-1/2-2/2-3/2-4) :
 * - `getAdminDb()` exclusivement (jamais `adminDb` direct).
 * - Pas de throw : tout catch → log warn FR + return `null`.
 * - Logs en français (C3) avec contexte `[structurer]`.
 * - Mode dégradé (C4) systématique.
 * - `serverTimestamp()` côté Firestore pour horodatage cohérent.
 * - `crypto.randomUUID()` natif Node 18+ pour `batchId`.
 *
 * C0/C2 enforcement :
 * - Le prompt **interdit explicitement** au LLM d'inventer.
 * - Le parser runtime tronque `actualites` à 5 max (defense in depth) et
 *   omet `url` si absente (pas d'invention côté parser non plus).
 * - Les champs `url`, `source`, `date` des actualités NE SONT PAS régénérés
 *   par le LLM : il les copie tels quels depuis l'article source.
 */

import { doc, serverTimestamp, setDoc } from "../lib/firestoreCompat";
import { Timestamp } from "../lib/firestoreCompat";
import type { Timestamp as FirestoreTimestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../firebaseAdmin";
import { loadPassingArticles } from "./persistence";
import type { VeilleRawArticle } from "./types";
import { getPerplexityClient, isPerplexityConfigured, DEFAULT_MODEL } from "./perplexityClient";
import type { PerplexityModel } from "./perplexityClient";
import type { VeilleReport } from "../../data/defaultReports";
import { auditRejectedArticle, isUnverifiable, type AuditLogEntry } from "./auditor";
import { createHash } from "node:crypto";

// ============================================================================
// Constantes
// ============================================================================

/** Nom de la collection Firestore où sont stockés les rapports hebdo. */
const REPORTS_COLLECTION = "reports";

/** Modèle Perplexity par défaut pour la veille (via OpenRouter). */
const PERPLEXITY_MODEL: PerplexityModel = DEFAULT_MODEL;

/** Timeout pour les appels Perplexity Deep Research (5 min). */
const PERPLEXITY_TIMEOUT_MS = 5 * 60 * 1000;

/** Limite stricte d'actualités dans un rapport (C6 rétrocompat 7→5). */
const ACTUALITES_MAX = 5;

/** Limite par défaut de chargement des articles passants. */
const DEFAULT_ARTICLE_LIMIT = 50;

/** Seuil minimum de score (politique caller, aligné sur `PASSING_SCORE_THRESHOLD`). */
const DEFAULT_MIN_SCORE = 60;

// ============================================================================
// Types exportés
// ============================================================================

/** Options de structuration (toutes optionnelles, défauts raisonnables). */
export interface StructureOptions {
  /** Identifiant semaine ISO (ex: "2026-w23"). Défaut = semaine courante. */
  weekId?: string;
  /** Limite d'articles chargés depuis Firestore. */
  limit?: number;
  /** Score minimum pour considérer un article comme "passant". */
  minScore?: number;
  /** Override du prompt (tests purs). */
  promptOverride?: string;
}

/** Rapport structuré enrichi des champs de tracking (persistance + audit). */
export interface StructuredVeilleReport extends VeilleReport {
  /** ID de semaine ISO (clef Firestore du document `reports/{weekId}`). */
  weekId: string;
  /** Horodatage de génération (Timestamp local, null si mode dégradé Firestore). */
  generatedAt: FirestoreTimestamp | null;
  /** Combien d'articles du corpus ont nourri ce rapport. */
  articlesUsed: number;
  /** UUID v4 du batch de structuration (pont audit story 2-6). */
  batchId: string;
}

// ============================================================================
// Helpers purs exportés (testables, réutilisables)
// ============================================================================

/**
 * Calcule l'identifiant de semaine ISO (YYYY-wN) depuis une Date.
 * Pure, déterministe. Reproduit le calcul existant de server.ts:152-157
 * (cohérence entre simulation et structuration réelle).
 */
export function computeWeekId(date: Date): string {
  // ISO 8601 week-of-year : reproduit server.ts:152-157 (logique simulation).
  // On travaille en UTC pour éviter les surprises TZ/DST.
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  // Jour de la semaine ISO : 1=lundi ... 7=dimanche.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Décalage au jeudi ISO de la même semaine.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  // Clamp w1..w53 (deferred work) : l'ISO 8601 autorise w53, on s'aligne.
  const clamped = Math.max(1, Math.min(53, weekNum));
  return `${d.getUTCFullYear()}-w${clamped}`;
}

/**
 * Construit le prompt Perplexity pour la structuration en 5 catégories.
 * C0/C2 enforcement : instructions explicites d'anti-hallucination,
 * contrainte 5 actus max, URL copiée exactement, sources issues du corpus.
 */
export function buildStructurationPrompt(articles: readonly VeilleRawArticle[]): string {
  const articlesBlock = articles
    .map(
      (a) =>
        `ID: ${a.id}|URL: ${a.url}|SOURCE: ${a.sourceId}|SCORE: ${a.score}|TITRE: ${a.title}|EXTRAIT: ${a.excerpt.slice(0, 300)}`,
    )
    .join("\n");

  return `Tu es un classificateur de veille SIRH/IA. Tu ne génères AUCUN fait, AUCUN chiffre, AUCUNE source qui ne soit pas dans la liste d'articles fournie.

Si une information n'est pas présente dans le corpus, omets-la. Ne complète jamais par hypothèse.

Chaque actualite.url doit être copiée EXACTEMENT depuis l'URL de l'article source. Aucune invention d'URL.

Limite STRICTE : 5 actualités maximum. Tu peux en mettre moins si le corpus est faible, mais jamais plus de 5.

Cinq catégories obligatoires :
1. Top 5 actualités (champ actualites, max 5)
2. Tendances émergentes (champ signalFaible)
3. Mouvements éditeurs (champ mouvements)
4. Risques réglementaires (champ reglementation)
5. Recommandations HRC (champ actions)

ARTICLES DU CORPUS (${articles.length}) :
${articlesBlock}

Retourne UNIQUEMENT le JSON, sans markdown, sans préambule.`;
}

/**
 * Normalise une URL pour cross-référence avec le corpus (cf. AC #4) :
 * - lowercase host
 * - strip `www.`
 * - strip UTM (`utm_*`, `fbclid`, `gclid`)
 * - strip trailing `/` après path
 * - strip fragment (`#...`)
 * - no-op si URL vide
 *
 * **Pure, déterministe, testable**. Exporté pour réutilisation par fixture.
 */
export function normalizeUrl(url: string): string {
  if (!url || url.length === 0) return "";
  let s = url.trim();
  // Strip fragment
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  // Strip UTM : on parse la query string et on retire les clés marketing.
  const qIdx = s.indexOf("?");
  let path = s;
  if (qIdx >= 0) {
    const qs = s.slice(qIdx + 1);
    path = s.slice(0, qIdx);
    const cleaned = qs
      .split("&")
      .filter((kv) => {
        const key = kv.split("=")[0].toLowerCase();
        return (
          key !== "" &&
          !key.startsWith("utm_") &&
          key !== "fbclid" &&
          key !== "gclid"
        );
      })
      .join("&");
    s = cleaned.length > 0 ? `${path}?${cleaned}` : path;
  }
  // Lowercase host (http(s)://host...)
  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(.*)$/i.exec(s);
  if (schemeMatch) {
    const [, scheme, host, rest] = schemeMatch;
    const lowerHost = host.toLowerCase().replace(/^www\./, "");
    s = `${scheme}${lowerHost}${rest}`;
  } else {
    // Pas de scheme, lowercase best-effort
    s = s.toLowerCase();
  }
  // Strip trailing `/` (après path, pas après query).
  const lastQ = s.indexOf("?");
  if (lastQ >= 0) {
    const before = s.slice(0, lastQ).replace(/\/+$/, "");
    const after = s.slice(lastQ);
    s = before + after;
  } else {
    s = s.replace(/\/+$/, "");
  }
  return s;
}

/**
 * Strip les fences markdown ``` ... ``` (et ```json) qui peuvent wrapper la
 * réponse JSON du LLM. Defense in depth contre wrapping intermittent.
 */
function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  // Bloc fenced ```...``` (multiligne)
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenceMatch) s = fenceMatch[1].trim();
  // Ligne simple ```json ou ``` orpheline en début/fin
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  return s.trim();
}

/**
 * Valide un sous-objet "string-only" : retourne l'objet validé ou `null`
 * si une des clés required n'est pas une string. Defense in depth contre
 * le LLM qui retournerait un sous-objet avec des champs null/number.
 */
function validateStringObject<T extends Record<string, unknown>>(
  raw: unknown,
  required: ReadonlyArray<keyof T & string>,
): T | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const k of required) {
    if (typeof obj[k] !== "string") return null;
  }
  return obj as T;
}

/**
 * Parse la réponse brute du LLM en `VeilleReport` validé runtime + rejets
 * d'audit (story 2-6, AC #3 + #4).
 *
 * **BREAKING (story 2-6)** : signature passe de
 * `(raw, weekId): VeilleReport | null` à
 * `(raw, weekId, corpusUrls): { report: VeilleReport | null; rejectedEntries: AuditLogEntry[] }`.
 *
 * Type guard manuel (zod non installé). Toute section absente → fallback safe.
 * JSON invalide → `{ report: null, rejectedEntries: [] }`. Ne throw JAMAIS.
 *
 * Defense in depth : strip markdown fences (LLM intermittent), top3
 * capé à 3, mouvements/reglementation/ressources/actions validés en
 * profondeur, chiffre/signalFaible peuvent être null si corpus faible.
 *
 * **Rejets d'audit** :
 * - `missing_url` : actualité sans URL (absente ou chaîne vide).
 * - `unverifiable_source` : URL présente mais hors corpus scanné.
 * - Pour chaque rejet, génère un `articleId` déterministe (hash du title
 *   ou UUID v4 fallback) et pousse dans `rejectedEntries`.
 */
export function parseGeminiResponse(
  raw: string,
  weekId: string,
  corpusUrls: ReadonlySet<string> = new Set(),
): { report: VeilleReport | null; rejectedEntries: AuditLogEntry[] } {
  // Strip markdown fences avant JSON.parse (le LLM peut wrapper en ```json).
  const cleaned = stripMarkdownFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { report: null, rejectedEntries: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { report: null, rejectedEntries: [] };
  }
  const obj = parsed as Record<string, unknown>;

  // top3 : cap à 3 (VeilleReport shape), defense in depth.
  const top3 = Array.isArray(obj.top3)
    ? (obj.top3.filter((x): x is string => typeof x === "string") as string[]).slice(0, 3)
    : [];

  // actualites : validation avec capture des rejets (AC #3 + #4).
  const actualitesRaw = Array.isArray(obj.actualites) ? obj.actualites : [];
  const rejectedEntries: AuditLogEntry[] = [];
  const actualites: VeilleReport["actualites"] = [];
  for (const item of actualitesRaw) {
    if (actualites.length >= ACTUALITES_MAX) break;
    if (!item || typeof item !== "object") continue;
    const itemObj = item as Record<string, unknown>;
    if (typeof itemObj.title !== "string") continue;
    const url = typeof itemObj.url === "string" ? itemObj.url : "";
    const title = itemObj.title as string;
    // Génère articleId déterministe (sha256 du title, hex 32 chars)
    // — on garde la même approche que persistence.hashUrl pour cohérence.
    const articleId =
      url.length > 0
        ? createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32)
        : createHash("sha256").update(`title:${title}`, "utf8").digest("hex").slice(0, 32);

    if (url.length === 0) {
      // AC #3 : URL absente ou chaîne vide → rejet missing_url.
      rejectedEntries.push({
        articleId,
        url: undefined,
        reason: "missing_url",
      });
      continue;
    }
    if (isUnverifiable(normalizeUrl(url), corpusUrls)) {
      // AC #4 : URL non présente dans le corpus scanné.
      rejectedEntries.push({
        articleId,
        url,
        reason: "unverifiable_source",
      });
      continue;
    }
    // Actualité valide : ajouter au rapport.
    actualites.push({
      title,
      source: typeof itemObj.source === "string" ? itemObj.source : "",
      date: typeof itemObj.date === "string" ? itemObj.date : "",
      summary: typeof itemObj.summary === "string" ? itemObj.summary : "",
      impact: typeof itemObj.impact === "string" ? itemObj.impact : "",
      tags: Array.isArray(itemObj.tags)
        ? itemObj.tags.filter((t): t is string => typeof t === "string")
        : [],
      url,
    });
  }

  // mouvements : deep validation sur title+details+category (tous string).
  const mouvements = Array.isArray(obj.mouvements)
    ? obj.mouvements
        .map((m) =>
          validateStringObject<{ title: string; details: string; category: string }>(m, [
            "title",
            "details",
            "category",
          ]),
        )
        .filter((m): m is { title: string; details: string; category: string } => m !== null)
    : [];

  // reglementation : deep validation sur title+detail+type.
  const reglementation = Array.isArray(obj.reglementation)
    ? obj.reglementation
        .map((r) =>
          validateStringObject<{ title: string; detail: string; type: string }>(r, [
            "title",
            "detail",
            "type",
          ]),
        )
        .filter((r): r is { title: string; detail: string; type: string } => r !== null)
    : [];

  // chiffre : défaut `null` (per Task 3.6, AC #7).
  const chiffre =
    validateStringObject<{ value: string; text: string; source: string }>(obj.chiffre, [
      "value",
      "text",
      "source",
    ]) ?? null;

  // signalFaible : défaut `null` (per Task 3.6, AC #7).
  const signalFaible =
    validateStringObject<{ title: string; description: string }>(obj.signalFaible, [
      "title",
      "description",
    ]) ?? null;

  // ressources : deep validation title+duration+type ; url optionnelle string.
  const ressources = Array.isArray(obj.ressources)
    ? obj.ressources
        .map((r) => {
          const validated = validateStringObject<{
            title: string;
            duration: string;
            type: string;
            url?: string;
          }>(r, ["title", "duration", "type"]);
          if (!validated) return null;
          const out: { title: string; duration: string; type: string; url?: string } = {
            title: validated.title,
            duration: validated.duration,
            type: validated.type,
          };
          if (typeof validated.url === "string" && validated.url.length > 0) {
            out.url = validated.url;
          }
          return out;
        })
        .filter(
          (r): r is { title: string; duration: string; type: string; url?: string } =>
            r !== null,
        )
    : [];

  // actions : deep validation title+detail ; confidentiality/criticality optionnels.
  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .map((a) => {
          const validated = validateStringObject<{
            title: string;
            detail: string;
            confidentiality?: string;
            criticality?: string;
          }>(a, ["title", "detail"]);
          if (!validated) return null;
          const out: { title: string; detail: string; confidentiality?: string; criticality?: string } = {
            title: validated.title,
            detail: validated.detail,
          };
          if (typeof validated.confidentiality === "string") {
            out.confidentiality = validated.confidentiality;
          }
          if (typeof validated.criticality === "string") {
            out.criticality = validated.criticality;
          }
          return out;
        })
        .filter(
          (a): a is { title: string; detail: string; confidentiality?: string; criticality?: string } =>
            a !== null,
        )
    : [];

  const idStr =
    typeof obj.id === "string" && obj.id.length > 0
      ? obj.id
      : `${weekId}-${Date.now()}`;

  return {
    report: {
      id: idStr,
      week: typeof obj.week === "string" ? obj.week : "",
      top3,
      actualites,
      mouvements,
      reglementation,
      chiffre,
      signalFaible,
      ressources,
      actions,
    },
    rejectedEntries,
  };
}

// ============================================================================
// JSON Schema standard pour Perplexity (OpenAI-compatible via OpenRouter)
// 8 sections, actualites max 5 — remplace l'ancien buildGeminiResponseSchema().
// ============================================================================

/**
 * Schéma JSON Schema standard pour la sortie structurée Perplexity.
 * Remplace buildGeminiResponseSchema() (Gemini Type.OBJECT → JSON Schema "object").
 * Utilisé via `response_format: { type: "json_schema", json_schema: { ... } }`.
 */
function buildPerplexityResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      week: {
        type: "string",
        description: "La semaine concernée (ex: 'Semaine du 4 Juin 2026')",
      },
      top3: {
        type: "array",
        items: { type: "string" },
        description: "Les 3 faits majeurs incontournables, chacun en 2-3 lignes.",
      },
      actualites: {
        type: "array",
        description:
          "Top 5 actualités de la semaine. Maximum 5 entrées (le parser tronque au-delà).",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            source: {
              type: "string",
              description: "Nom de la source (ex: 'RH Info', 'Parlons RH')",
            },
            date: { type: "string" },
            summary: { type: "string", description: "Résumé factuel 3-4 lignes" },
            impact: {
              type: "string",
              description: "Impact potentiel et valeur de conseil pour consultants SIRH",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Exemples: recrutement, paie, analytique, éthique, marché, juridique",
            },
            url: {
              type: "string",
              description: "URL EXACTE copiée depuis l'article source. Aucune invention.",
            },
          },
          required: ["title", "source", "date", "summary", "impact", "tags"],
        },
      },
      mouvements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Nom de l'éditeur ou startup" },
            details: { type: "string", description: "Description de la fonctionnalité/rachat/levée" },
            category: { type: "string", description: "ex: 'Fonctionnalité', 'Partenariat / Acquisition'" },
          },
          required: ["title", "details", "category"],
        },
      },
      reglementation: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string", description: "Analyse IA Act, CNIL, RGPD, éthique" },
            type: { type: "string", description: "ex: 'IA Act', 'RGPD', 'CNIL'" },
          },
          required: ["title", "detail", "type"],
        },
      },
      chiffre: {
        type: "object",
        properties: {
          value: { type: "string", description: "ex: '74%'" },
          text: { type: "string", description: "Contexte complet" },
          source: { type: "string", description: "Origine ou étude" },
        },
        required: ["value", "text", "source"],
      },
      signalFaible: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
      },
      ressources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            duration: { type: "string", description: "ex: 'Lecture 12 min'" },
            type: { type: "string", description: "ex: 'Guide', 'Rapport'" },
            url: { type: "string", description: "URL optionnelle" },
          },
          required: ["title", "duration", "type"],
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string", description: "Action concrète cabinet SIRH" },
          },
          required: ["title", "detail"],
        },
      },
    },
    required: [
      "week",
      "top3",
      "actualites",
      "mouvements",
      "reglementation",
      "chiffre",
      "signalFaible",
      "ressources",
      "actions",
    ],
  };
}

// ============================================================================
// Orchestrateur principal
// ============================================================================

/**
 * Orchestrateur de structuration hebdomadaire.
 *
 * Étapes :
 *   1. Charger `VeilleRawArticle` passants via `loadPassingArticles`.
 *   2. Si corpus vide → retourne `null` (log warn `[structurer]`).
 *   3. Si `OPENROUTER_API_KEY` absent → retourne `null` (mode simulation géré
 *      par le caller, story 2-1).
 *   4. Construire le prompt Perplexity (`buildStructurationPrompt`).
 *   5. Appeler Perplexity avec `response_format` JSON Schema strict (8 sections, actus max 5).
 *   6. Parser la réponse (`parseGeminiResponse`).
 *   7. Si `null` → retourne `null` (log warn).
 *   8. Persister dans `reports/{weekId}` (upsert idempotent).
 *   9. Retourner le rapport enrichi (id, weekId, articlesUsed, batchId,
 *      generatedAt).
 *
 * **Ne throw JAMAIS** : tout catch → log warn FR + return `null`.
 */
export async function structureWeeklyReport(
  options?: StructureOptions,
): Promise<StructuredVeilleReport | null> {
  const weekId = options?.weekId ?? computeWeekId(new Date());
  const limit = options?.limit ?? DEFAULT_ARTICLE_LIMIT;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;

  // Étape 1 : charger le corpus.
  const articles = await loadPassingArticles(limit, minScore);

  // Étape 2 : corpus vide.
  if (articles.length === 0) {
    console.warn(`[structurer] corpus vide (limit=${limit}, minScore=${minScore}), pas de rapport`);
    return null;
  }

  // Étape 3 : clé API absente (simulation déjà gérée par caller).
  if (!isPerplexityConfigured()) {
    console.warn("[structurer] OPENROUTER_API_KEY absente, mode simulation délégué au caller");
    return null;
  }

  // Étape 4 : prompt Perplexity.
  const prompt = options?.promptOverride ?? buildStructurationPrompt(articles);

  // Étape 5 : appel Perplexity via OpenRouter.
  let rawResponse: string;
  try {
    const client = getPerplexityClient();
    const schema = buildPerplexityResponseSchema();
    const response = await client.chat.completions.create(
      {
        model: PERPLEXITY_MODEL,
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
            schema,
          },
        },
        max_tokens: 8000,
        temperature: 0.3,
      },
      {
        // Deep Research peut prendre 1-5 min
        timeout: PERPLEXITY_TIMEOUT_MS,
      },
    );
    rawResponse = response.choices[0]?.message?.content || "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[structurer] appel Perplexity échoué : ${message}`);
    return null;
  }

  if (!rawResponse || rawResponse.trim() === "") {
    console.warn("[structurer] Perplexity a retourné une réponse vide");
    return null;
  }

  // Étape 6 : parser avec cross-référence corpus (story 2-6, AC #3 + #4).
  // Construit le Set des URLs normalisées une seule fois (O(1) lookups).
  const corpusUrls = new Set<string>(articles.map((a) => normalizeUrl(a.url)));
  // Génère le batchId ICI (une fois par run) : utilisé pour corrélation
  // rapport↔audits. Story 2-6 Task 4.4 : audit doit JAMAIS bloquer.
  const batchId = crypto.randomUUID();
  const { report, rejectedEntries } = parseGeminiResponse(rawResponse, weekId, corpusUrls);

  // Étape 6bis : journaliser les rejets d'audit (fire-and-forget, story 2-6 AC #5).
  // Pattern obligatoire : `void ... .catch(() => {})` pour ne JAMAIS bloquer
  // le pipeline (cf. story 2-6 Task 3.6).
  for (const entry of rejectedEntries) {
    void auditRejectedArticle(entry, { weekId, batchId }).catch(() => {});
  }

  // Étape 7 : parser a échoué.
  if (report === null) {
    console.warn(`[structurer] parsing JSON échoué (weekId=${weekId})`);
    return null;
  }
  const db = getAdminDb();
  // Patch #3 : serverTimestamp() côté Firestore résolu en `null` client-side.
  // On utilise Timestamp.fromMillis(Date.now()) pour donner un horodatage
  // local au caller. Côté Firestore, serverTimestamp() persiste le vrai
  // temps serveur dans le doc (visible à la query lecture cf. endpoint latest).
  let generatedAt: FirestoreTimestamp | null = Timestamp.fromMillis(Date.now());
  if (db) {
    try {
      const ref = doc(db, REPORTS_COLLECTION, weekId);
      await setDoc(ref, {
        report,
        weekId,
        generatedAt: serverTimestamp(),
        articlesUsed: articles.length,
        batchId,
      });
      console.log(
        `[structurer] rapport ${weekId} persisté : ${articles.length} articles, batchId=${batchId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[structurer] persistance rapport échouée : ${message}`);
      // On continue et on retourne le rapport quand même (avec generatedAt local).
    }
  } else {
    console.warn(
      `[structurer] Firestore indispo, rapport non persisté (weekId=${weekId})`,
    );
  }

  // Étape 9 : enrichir et retourner.
  return {
    ...report,
    weekId,
    generatedAt,
    articlesUsed: articles.length,
    batchId,
  };
}
