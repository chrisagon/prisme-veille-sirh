/**
 * Worker de scan périodique configurable (CAP-2 spec veille automatique).
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2)
 * Cf. _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md
 *
 * Responsabilités :
 * - Lire les sources actives depuis Firestore (`veille_sources`).
 * - Filtrer par fréquence configurée (daily / weekly / custom CRON).
 * - Dédoublonner les exécutions concurrentes (flag mémoire).
 * - Fetch HTTP robuste par type (rss / sitemap / api).
 * - Dédoublonnage intra-scan par URL canonique.
 * - Mettre à jour `lastScanAt` best-effort.
 * - Logger le résultat structuré (console + Firestore `veille_scan_log`).
 *
 * Anti-hallucination (C0) : le worker NE GÉNÈRE PAS de contenu. Il collecte
 * uniquement des métadonnées (title, url, publishedAt) issues directement
 * des sources. Pas de LLM appelé ici.
 */

import { XMLParser } from "fast-xml-parser";
import { doc, serverTimestamp, setDoc, getDoc, QueryDocumentSnapshot } from "../lib/firestoreCompat";
import { getAdminDb } from "../firebaseAdmin";
import { fetchWithRateLimit, readTextBounded, newScanId } from "./fetch";
import {
  ArticleCandidate,
  ScanResult,
  SourceScanResult,
} from "./types";
import { VeilleSource, ScanFrequency } from "../../types/veille";
import { extractAndPersistAll } from "./persistence";

const SCAN_LOG_COLLECTION = "veille_scan_log";
const SOURCES_COLLECTION = "veille_sources";
const SCAN_LOCK_COLLECTION = "scan_lock";
const SCAN_LOCK_TTL_MS = 5 * 60 * 1000; // 5 min
const MAX_ARTICLES_PER_SCAN = 50;
const MAX_DESCRIPTION_CHARS = 50_000; // F8 : cap anti-feed malicieux (~50 KB).

// Allowlist des noms de variables d'environnement autorisées pour `apiKeyEnvVar`.
// Un admin compromis ne peut pas exfiltrer SMTP_PASS / OPENROUTER_API_KEY etc.
const ALLOWED_API_KEY_ENV_VARS = new Set([
  "NEWSAPI_KEY",
  "GNEWS_KEY",
  "MEDIASTACK_KEY",
]);

let scanInProgress = false;

// ============================================================================
// Gating temporel
// ============================================================================

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

/** Convertit un Firestore Timestamp | null en epoch ms. */
function toEpoch(ts: { toMillis: () => number } | null | undefined): number {
  if (!ts) return 0;
  return ts.toMillis();
}

/**
 * Évalue une expression CRON 5-champs (minute hour day-of-month month day-of-week).
 * Retourne `true` si la prochaine occurrence est <= now.
 * Supporte `*`, `,`, `-`, `/`. Pas de @yearly/@monthly (hors spec).
 */
const FIELD_MAX: Record<string, { max: number; min: number }> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 6 },
};

function cronMatchesNow(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dom, month, dow] = parts;
  const fieldToMatch: Array<[string, number, string]> = [
    [minute, now.getMinutes(), "minute"],
    [hour, now.getHours(), "hour"],
    [dom, now.getDate(), "dom"],
    [month, now.getMonth() + 1, "month"],
    [dow, now.getDay(), "dow"],
  ];
  return fieldToMatch.every(([field, value, key]) => {
    const range = FIELD_MAX[key];
    return matchField(field, value, range.min, range.max);
  });
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  // Step `*/n` ou `m-n/s`
  if (field.includes("/")) {
    const [range, stepStr] = field.split("/");
    const step = Number.parseInt(stepStr, 10);
    if (Number.isNaN(step) || step <= 0) return false;
    const [start, end] = range === "*" ? [min, max] : range.split("-").map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    for (let v = start; v <= end; v += step) {
      if (v === value) return true;
    }
    return false;
  }
  // Range `m-n`
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = Number.parseInt(startStr, 10);
    const end = Number.parseInt(endStr, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return value >= start && value <= end;
  }
  // List `m,n,k`
  if (field.includes(",")) {
    const parsed = field
      .split(",")
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => !Number.isNaN(n));
    return parsed.includes(value);
  }
  // Wildcard ou valeur fixe
  if (field === "*") return true;
  const fixed = Number.parseInt(field, 10);
  return fixed === value;
}

/** Détermine si une source doit être scannée maintenant. */
function shouldScan(source: VeilleSource, now: Date): { scan: boolean; reason?: string } {
  const freq: ScanFrequency = source.scanFrequency;
  const lastEpoch = toEpoch(source.lastScanAt);
  const nowEpoch = now.getTime();
  if (freq === "daily") {
    if (lastEpoch === 0 || nowEpoch - lastEpoch >= DAILY_MS) {
      return { scan: true };
    }
    return { scan: false, reason: "daily_gating" };
  }
  if (freq === "weekly") {
    if (lastEpoch === 0 || nowEpoch - lastEpoch >= WEEKLY_MS) {
      return { scan: true };
    }
    return { scan: false, reason: "weekly_gating" };
  }
  // custom
  if (!source.cronExpression || source.cronExpression.trim() === "") {
    return { scan: false, reason: "custom_no_cron_expression" };
  }
  if (!cronMatchesNow(source.cronExpression, now)) {
    return { scan: false, reason: "custom_cron_not_due" };
  }
  return { scan: true };
}

// ============================================================================
// Parsers
// ============================================================================

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  "atom:link"?: { "@_href"?: string };
  published?: string;
  updated?: string;
  description?: string;
  "content:encoded"?: string;
  "content"?: string;
  summary?: string;
}

function pickText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    const inner = (value as { "#text": unknown })["#text"];
    if (typeof inner === "string") return inner;
    if (typeof inner === "number") return String(inner);
  }
  return "";
}

function firstLink(item: RssItem): string {
  if (item.link) return pickText(item.link).trim();
  if (item.guid) return pickText(item.guid).trim();
  const atomLink = item["atom:link"];
  if (atomLink && typeof atomLink === "object" && "@_href" in atomLink) {
    return String(atomLink["@_href"] ?? "").trim();
  }
  return "";
}

function firstDate(item: RssItem): string | null {
  const candidates = [item.pubDate, item.published, item.updated];
  for (const c of candidates) {
    const text = pickText(c).trim();
    if (text) {
      const ts = Date.parse(text);
      if (!Number.isNaN(ts)) return new Date(ts).toISOString();
    }
  }
  return null;
}

function parseRssFeed(xmlText: string, sourceId: string): ArticleCandidate[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xmlText);
  } catch (err) {
    // F15 : XML malformé → log + return [] (au lieu de propager vers scanSource).
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scanner] XML RSS malformé pour ${sourceId} : ${message}`);
    return [];
  }
  const rss = (parsed as { rss?: unknown; feed?: unknown }).rss ?? (parsed as { feed?: unknown }).feed;
  if (!rss) return [];
  const channel = (rss as { channel?: unknown }).channel ?? rss;
  const itemsRaw = (channel as { item?: unknown; entry?: unknown }).item ?? (channel as { entry?: unknown }).entry;
  if (!itemsRaw) return [];
  const items: RssItem[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
  return items
    .map((item) => {
      // Description = `content:encoded` (HTML riche, RSS 2.0) > `description` (RSS 2.0)
      // > `content` (Atom) > `summary` (Atom). Préférer le plus informatif.
      // F14 : trim inliné. F8 : cap MAX_DESCRIPTION_CHARS.
      const description = (
        pickText(item["content:encoded"]) ||
        pickText(item.description) ||
        pickText(item.content) ||
        pickText(item.summary)
      ).trim().slice(0, MAX_DESCRIPTION_CHARS);
      return {
        url: firstLink(item),
        title: pickText(item.title).trim(),
        publishedAt: firstDate(item),
        sourceId,
        sourceType: "rss" as const,
        ...(description ? { description } : {}),
      };
    })
    .filter((c) => c.url.length > 0);
}

function parseSitemapUrls(xmlText: string, sourceId: string): ArticleCandidate[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xmlText);
  } catch (err) {
    // F15 : idem parseRssFeed.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scanner] XML sitemap malformé pour ${sourceId} : ${message}`);
    return [];
  }
  const root = parsed as { urlset?: unknown; url?: unknown };
  const urlset = root.urlset ?? parsed;
  const urlsRaw = (urlset as { url?: unknown }).url ?? root.url;
  if (!urlsRaw) return [];
  const urls: Array<{ loc?: unknown; lastmod?: unknown }> = Array.isArray(urlsRaw) ? urlsRaw : [urlsRaw];
  return urls
    .map((entry) => {
      const loc = pickText(entry.loc).trim();
      const lastmod = entry.lastmod ? pickText(entry.lastmod).trim() : "";
      let publishedAt: string | null = null;
      if (lastmod) {
        const ts = Date.parse(lastmod);
        if (!Number.isNaN(ts)) publishedAt = new Date(ts).toISOString();
      }
      return {
        url: loc,
        title: "",
        publishedAt,
        sourceId,
        sourceType: "sitemap" as const,
      };
    })
    .filter((c) => c.url.length > 0);
}

async function fetchApiSource(
  url: string,
  apiKeyEnvVar: string | undefined,
  sourceId: string,
): Promise<ArticleCandidate[]> {
  const headers: Record<string, string> = {};
  if (apiKeyEnvVar) {
    if (!ALLOWED_API_KEY_ENV_VARS.has(apiKeyEnvVar)) {
      // Refus : apiKeyEnvVar hors allowlist (potentielle exfiltration de secrets).
      throw new Error(`apiKeyEnvVar non autorisée (allowlist)`);
    }
    const key = process.env[apiKeyEnvVar];
    if (!key) {
      throw new Error(`Variable d'environnement API absente`);
    }
    headers["Authorization"] = `Bearer ${key}`;
  }
  const response = await fetchWithRateLimit(url, { headers });
  const text = await readTextBounded(response);
  // Tenter JSON, sinon considérer comme RSS générique
  try {
    const json = JSON.parse(text) as {
      articles?: Array<{ url?: string; title?: string; publishedAt?: string; published_at?: string }>;
      data?: Array<{ url?: string; title?: string; publishedAt?: string }>;
    };
    const items = json.articles ?? json.data ?? [];
    return items
      .map((item) => ({
        url: (item.url ?? "").trim(),
        title: (item.title ?? "").trim(),
        publishedAt: item.publishedAt ?? item.published_at ?? null,
        sourceId,
        sourceType: "api" as const,
      }))
      .filter((c) => c.url.length > 0);
  } catch {
    // Pas du JSON → repli sur parse RSS
    return parseRssFeed(text, sourceId);
  }
}

// ============================================================================
// Dédoublonnage intra-scan
// ============================================================================

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igshid",
]);

/**
 * Canonicalise une URL pour dédoublonnage intra-scan :
 * - scheme lowercase
 * - host lowercase + strip "www." initial
 * - path inchangé (case-sensitive)
 * - query params : retire les trackers (utm_*, fbclid, gclid, etc.)
 * - fragment retiré
 * - trailing slash retiré
 */
function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.host = u.host.toLowerCase();
    if (u.host.startsWith("www.")) u.host = u.host.slice(4);
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return raw.trim();
  }
}

// ============================================================================
// Fenêtre temporelle hebdomadaire
// ============================================================================

// Tolérance pour les flux avec léger décalage d'horloge (pubDate dans le futur proche).
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000; // 1h

function isWithinWeeklyWindow(publishedAt: string | null, now: Date): boolean {
  if (!publishedAt) return false; // pas de date → on exclut (cf. AC#8 alignement)
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  const ageMs = now.getTime() - ts;
  // Articles datés dans le futur : tolérance limitée pour drift d'horloge.
  if (ageMs < 0) {
    return ageMs > -FUTURE_TOLERANCE_MS;
  }
  return ageMs <= WEEKLY_MS;
}

// ============================================================================
// Log Firestore
// ============================================================================

async function logScanResult(result: ScanResult): Promise<void> {
  console.log(
    `[scanner] scan ${result.scanId} termine - ${result.sourcesScanned} scannées, ${result.sourcesSkipped} skippées, ${result.articlesFound} articles trouvés, ${result.articlesDeduped} dédupliqués, ${result.errors.length} erreurs`,
  );
  const db = getAdminDb();
  if (!db) {
    // Mode dégradé : on ne persiste pas le log.
    return;
  }
  try {
    const ref = doc(db, SCAN_LOG_COLLECTION, result.scanId);
    const { scanId, ...rest } = result;
    void scanId;
    await setDoc(ref, {
      ...rest,
      scanId: result.scanId,
      loggedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[scanner] impossible de persister le log de scan :", err);
  }
}

// ============================================================================
// Update lastScanAt
// ============================================================================

async function updateLastScanAt(sourceId: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  try {
    const ref = doc(db, SOURCES_COLLECTION, sourceId);
    await setDoc(ref, { lastScanAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn(`[scanner] lastScanAt update échoué pour ${sourceId} :`, err);
  }
}

// ============================================================================
// Lock Firestore distribué
// ============================================================================

/**
 * Acquiert un lock distribué `scan_lock/{scanId}` avec TTL.
 * Retourne `true` si acquis, `false` si déjà pris par un autre scan encore valide.
 * En mode dégradé (Firestore indisponible), retourne `true` (le mutex in-memory
 * `scanInProgress` couvre le cas mono-process).
 */
async function acquireScanLock(scanId: string, acquiredBy: string): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return true;
  const ref = doc(db, SCAN_LOCK_COLLECTION, scanId);
  const now = Date.now();
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const data = existing.data() as { expiresAt?: number };
      if (data.expiresAt && data.expiresAt > now) {
        // Lock encore valide
        return false;
      }
    }
    await setDoc(ref, {
      acquiredAt: now,
      acquiredBy,
      expiresAt: now + SCAN_LOCK_TTL_MS,
    });
    return true;
  } catch (err) {
    console.warn(`[scanner] lock Firestore indispo, fallback mutex in-memory :`, err);
    return true;
  }
}

async function releaseScanLock(scanId: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  try {
    const ref = doc(db, SCAN_LOCK_COLLECTION, scanId);
    await setDoc(ref, {}, { merge: true }); // no-op pour respecter TTL
  } catch {
    // best-effort
  }
}

// ============================================================================
// Orchestration
// ============================================================================

async function scanSource(
  source: VeilleSource,
  now: Date,
  seenUrls: Set<string>,
): Promise<{ result: SourceScanResult; candidates: ArticleCandidate[]; dedupCount: number }> {
  const startMs = Date.now();
  const sourceId = source.id;

  // Validation URL
  if (!source.url || !source.url.startsWith("http")) {
    return {
      result: {
        sourceId,
        sourceName: source.name,
        sourceType: source.type,
        skipped: true,
        skipReason: "invalid_url",
        articlesFound: 0,
        errors: 0,
        durationMs: 0,
      },
      candidates: [],
      dedupCount: 0,
    };
  }

  try {
    let rawCandidates: ArticleCandidate[] = [];
    if (source.type === "rss") {
      const response = await fetchWithRateLimit(source.url);
      const text = await readTextBounded(response);
      rawCandidates = parseRssFeed(text, sourceId);
    } else if (source.type === "sitemap") {
      const response = await fetchWithRateLimit(source.url);
      const text = await readTextBounded(response);
      rawCandidates = parseSitemapUrls(text, sourceId);
    } else if (source.type === "api") {
      rawCandidates = await fetchApiSource(source.url, source.apiKeyEnvVar, sourceId);
    }

    // Filtrage fenêtre hebdomadaire + dédoublonnage intra-scan
    const filtered = rawCandidates.filter(
      (c) => isWithinWeeklyWindow(c.publishedAt, now),
    );
    const deduped: ArticleCandidate[] = [];
    let dedupCount = 0;
    for (const candidate of filtered) {
      const canon = canonicalizeUrl(candidate.url);
      if (seenUrls.has(canon)) {
        dedupCount++;
        continue;
      }
      seenUrls.add(canon);
      deduped.push({ ...candidate, url: canon });
    }

    return {
      result: {
        sourceId,
        sourceName: source.name,
        sourceType: source.type,
        skipped: false,
        articlesFound: deduped.length,
        errors: 0,
        durationMs: Date.now() - startMs,
      },
      candidates: deduped,
      dedupCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [scanner] source ${sourceId} (${source.url}) : ${message}`);
    return {
      result: {
        sourceId,
        sourceName: source.name,
        sourceType: source.type,
        skipped: false,
        articlesFound: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      },
      candidates: [],
      dedupCount: 0,
    };
  }
}

/**
 * Orchestrateur principal. Appelé par le cron ET par l'endpoint admin.
 * Idempotent : retourne immédiatement si un scan est déjà en cours.
 * Cross-replica safe grâce au lock Firestore `scan_lock/{scanId}` (TTL 5 min).
 */
export async function scanActiveSources(): Promise<ScanResult> {
  if (scanInProgress) {
    console.log("[scanner] scan deja en cours, skip (mutex in-memory).");
    return {
      scanId: `skipped-${Date.now()}`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      sourcesScanned: 0,
      sourcesSkipped: 0,
      articlesFound: 0,
      articlesDeduped: 0,
      sources: [],
      errors: [],
      articles: [],
      skipped: true,
      reason: "scan_in_progress",
    };
  }

  const scanId = newScanId();
  const lockAcquired = await acquireScanLock(scanId, `worker-${process.pid}`);
  if (!lockAcquired) {
    console.log(`[scanner] lock Firestore tenu par un autre scan, skip.`);
    return {
      scanId: `skipped-${Date.now()}`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      sourcesScanned: 0,
      sourcesSkipped: 0,
      articlesFound: 0,
      articlesDeduped: 0,
      sources: [],
      errors: [],
      articles: [],
      skipped: true,
      reason: "scan_in_progress_locked",
    };
  }

  scanInProgress = true;
  const startedAt = new Date();
  const sources: SourceScanResult[] = [];
  const errors: ScanResult["errors"] = [];
  const allArticles: ArticleCandidate[] = [];
  let totalArticles = 0;
  let totalDeduped = 0;

  try {
    console.log(`[scanner] demarrage scan ${scanId} (${startedAt.toISOString()})`);
    // Récupération des sources actives (admin SDK bypass rules)
    let sourceDocs: QueryDocumentSnapshot[] | null = null;
    const db = getAdminDb();
    if (db) {
      try {
        const snapshot = await db
          .collection(SOURCES_COLLECTION)
          .where("active", "==", true)
          .where("scanFrequency", "in", ["daily", "weekly", "custom"])
          .get();
        sourceDocs = snapshot.docs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[scanner] Firestore indisponible (${message}) - scan en mode dégradé sans persistance.`);
      }
    } else {
      console.warn("[scanner] getAdminDb() === null, scan en mode dégradé (sans persistance).");
    }
    const fetchedSources: VeilleSource[] = sourceDocs
      ? sourceDocs.map((d) => ({ id: d.id, ...(d.data() as Omit<VeilleSource, "id">) }))
      : [];

    const seenUrls = new Set<string>();
    for (const source of fetchedSources) {
      const decision = shouldScan(source, startedAt);
      if (!decision.scan) {
        sources.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          skipped: true,
          skipReason: decision.reason,
          articlesFound: 0,
          errors: 0,
          durationMs: 0,
        });
        continue;
      }
      const { result, candidates, dedupCount } = await scanSource(source, startedAt, seenUrls);
      sources.push(result);
      totalArticles += result.articlesFound;
      totalDeduped += dedupCount;
      if (result.errors > 0) {
        errors.push({
          sourceId: source.id,
          url: source.url,
          message: `Source ${source.id} a échoué (voir logs précédents)`,
        });
      }
      // Mise à jour `lastScanAt` UNIQUEMENT si le scan a effectivement produit des articles
      // ET n'a pas rencontré d'erreur. Une erreur transitoire (503, timeout) ne doit pas
      // réinitialiser le gating temporel et perdre la source pour 24h-7j.
      if (candidates.length > 0 && result.errors === 0) {
        await updateLastScanAt(source.id);
        // Accumule les articles pour le pipeline de scoring (persistance story 2-4).
        for (const c of candidates) {
          if (allArticles.length < MAX_ARTICLES_PER_SCAN) {
            allArticles.push(c);
          }
        }
      }
    }
    const finishedAt = new Date();
    const sourcesScanned = sources.filter((s) => !s.skipped).length;
    const sourcesSkipped = sources.filter((s) => s.skipped).length;
    const result: ScanResult = {
      scanId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      sourcesScanned,
      sourcesSkipped,
      articlesFound: totalArticles,
      articlesDeduped: totalDeduped,
      sources,
      errors,
      articles: allArticles,
    };
    // Story 2-4 : persistance async des articles scorés (fire-and-forget).
    // Ne bloque pas le retour de `scanActiveSources`. Erreurs capturées
    // localement, jamais propagées au caller (cf. spec CAP-2 stockage tampon).
    if (allArticles.length > 0) {
      console.log(`[scanner] persistance démarrée pour ${allArticles.length} articles (scanId=${scanId})`);
      void extractAndPersistAll(allArticles, scanId).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[scanner] persistance async échouée : ${message}`);
      });
    }
    await logScanResult(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scanner] crash inattendu : ${message}`);
    const finishedAt = new Date();
    const result: ScanResult = {
      scanId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      sourcesScanned: 0,
      sourcesSkipped: 0,
      articlesFound: 0,
      articlesDeduped: 0,
      sources: [],
      errors: [{ sourceId: "*", url: "*", message }],
      articles: [],
    };
    await logScanResult(result);
    return result;
  } finally {
    scanInProgress = false;
    await releaseScanLock(scanId);
  }
}

// ============================================================================
// Handlers "fire and forget" pour cron + admin
// ============================================================================

/** Handler fire-and-forget pour cron. Logge les erreurs sans propager. */
export function handleScanCronTick(): void {
  void scanActiveSources().catch((err) => {
    console.error("❌ [scanner] cron tick crash :", err);
  });
}
