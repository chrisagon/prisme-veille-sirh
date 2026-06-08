/**
 * Service de persistance des articles bruts dans Firestore (CAP-2 spec veille
 * automatique — stockage temporaire avec TTL 7 jours).
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2 stockage tampon)
 * Cf. _bmad-output/implementation-artifacts/2-4-stockage-temporaire-firestore-avec-ttl.md
 *
 * Responsabilités :
 * - Persister les `ExtractedArticle` scorés dans `veille_raw_articles` avec TTL 7j.
 * - Dédoublonner par URL canonique (id déterministe SHA-256, upsert idempotent).
 * - Lire les articles passants (`score >= seuil && !rejected`) pour le lecteur
 *   de structuration (story 2-5).
 * - Purger les articles expirés (job quotidien custom + TTL natif Firestore).
 * - Mode dégradé (Firestore indispo) : retourne des objets défaut, jamais throw.
 * - Anti-hallucination (C0) : copie conforme. Pas de transformation, pas de
 *   génération, pas de LLM.
 *
 * Patterns respectés (cf. stories 2-1/2-2/2-3) :
 * - `getAdminDb()` exclusivement (jamais `adminDb` direct).
 * - Pas de throw : tout catch → log warn FR + return défaut (zéros).
 * - Logs en français (C3) avec contexte `[persistence]`.
 * - Mode dégradé (C4) systématique.
 * - `serverTimestamp()` côté Firestore pour horloge cohérente.
 * - `crypto.randomUUID()` natif Node 18+ pour `batchId`.
 */

import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  QueryDocumentSnapshot,
  Timestamp,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  QueryDocumentSnapshot,
} from "../lib/firestoreCompat";
import { createHash } from "node:crypto";
import { getAdminDb } from "../firebaseAdmin";
import { loadReliabilityMap } from "./sourceReliabilityCache";
import { scoreArticle } from "./scorer";
import { extractArticleContent } from "./extractor";
import { auditRejectedArticle } from "./auditor";
import {
  ArticleCandidate,
  ArticleScore,
  ExtractedArticle,
  VeilleRawArticle,
  BATCH_RETENTION_MS,
  PASSING_SCORE_THRESHOLD,
} from "./types";

/** Nom de la collection Firestore (cf. AC #1, AC #2). */
const RAW_COLLECTION = "veille_raw_articles";

/** Taille d'un batch Firestore (limite API : 500 writes). */
const FIRESTORE_BATCH_SIZE = 500;

/** Cap de concurrence pour `extractAndPersistAll` (anti-Firestore rate limit). */
const PERSIST_CONCURRENCY_CAP = 5;

// ============================================================================
// Types exportés
// ============================================================================

/** Résultat d'un appel `persistExtractedArticle`. */
export interface PersistResult {
  /** `1` si set/update réussi, `0` sinon. */
  persisted: 0 | 1;
  /** `1` si mode dégradé (Firestore indispo), `0` sinon. */
  skipped: 0 | 1;
  /** Raison si skipped. */
  reason?: "firestore_unavailable" | "write_failed";
  /** Doc id utilisé (pour traçabilité). */
  docId: string;
}

/** Résultat agrégé d'un appel `extractAndPersistAll`. */
export interface BatchResult {
  /** Articles persistés avec succès. */
  persisted: number;
  /** Articles skippés (Firestore indispo). */
  skipped: number;
  /** Articles échoués (extraction KO, score throw hypothétique). */
  failed: number;
  /** UUID v4 du batch (un seul par appel). */
  batchId: string;
}

/** Résultat d'un appel `purgeExpiredArticles`. */
export interface PurgeResult {
  /** Nombre de docs supprimés. */
  purged: number;
  /** Durée de l'opération en ms. */
  durationMs: number;
  /** Raison si mode dégradé. */
  reason?: "firestore_unavailable" | "purge_failed";
}

// ============================================================================
// Helpers purs
// ============================================================================

/**
 * Calcule la date d'expiration (now + 7 jours). Pure, déterministe, testable.
 * Utilisé par `persistExtractedArticle` et les tests purs.
 */
export function computeExpiresAt(persistedAt: Date = new Date()): Date {
  return new Date(persistedAt.getTime() + BATCH_RETENTION_MS);
}

/**
 * Calcule le flag `passing` runtime. Non persisté : permet de modifier le
 * seuil (`PASSING_SCORE_THRESHOLD`) sans migration.
 */
export function computePassing(score: number, rejected: boolean): boolean {
  if (rejected) return false;
  return score >= PASSING_SCORE_THRESHOLD;
}

/**
 * Convertit un DocumentSnapshot Firestore en `VeilleRawArticle` runtime
 * (avec `passing` recalculé). Tolère les champs absents (Firestore indispo,
 * migration partielle, doc corrompu).
 */
function docToVeilleRawArticle(docSnap: QueryDocumentSnapshot): VeilleRawArticle | null {
  try {
    const data = docSnap.data();
    const score = typeof data.score === "number" && Number.isFinite(data.score) ? data.score : 0;
    const rejected = data.rejected === true;
    const components = data.components ?? {
      keywordDensity: 0,
      sourceReliability: 0,
      recency: 0,
      antiPromo: 1,
    };
    return {
      id: docSnap.id,
      url: data.url ?? "",
      title: data.title ?? "",
      textContent: data.textContent ?? "",
      excerpt: data.excerpt ?? "",
      publishedAt: data.publishedAt ?? null,
      sourceId: data.sourceId ?? "",
      sourceType: data.sourceType ?? "rss",
      score,
      components,
      promoScore: typeof data.promoScore === "number" ? data.promoScore : 0,
      rejected,
      ...(data.rejectionReason === "promotional_content" || data.rejectionReason === "empty_content"
        ? { rejectionReason: data.rejectionReason }
        : {}),
      extractedAt: data.extractedAt ?? "",
      scoredAt: data.scoredAt ?? "",
      scanId: data.scanId ?? "",
      batchId: data.batchId ?? "",
      // Cast vers Timestamp | null : Firestore renvoie un Timestamp à la
      // lecture (jamais FieldValue, qui n'existe qu'en entrée d'écriture).
      persistedAt: (data.persistedAt ?? null) as Timestamp | null,
      expiresAt: (data.expiresAt ?? null) as Timestamp | null,
      passing: computePassing(score, rejected),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[persistence] doc ${docSnap.id} corrompu, skip : ${message}`);
    return null;
  }
}

// ============================================================================
// Persistance
// ============================================================================

/**
 * Persiste un article extrait+scoré dans `veille_raw_articles`.
 *
 * - `publishedAt` est passé séparément (extrait du `ArticleCandidate` parent)
 *   car `ExtractedArticle` ne le porte pas.
 * - Dédup par URL via id déterministe `SHA-256(url)[:32]` (hex). Élimine la
 *   race condition du pattern "query dedup → set/update" : deux workers
 *   concurrents traitant la même URL convergent vers le même id, et
 *   `setDoc` est idempotent (upsert). Aucun read préalable.
 * - `persistedAt` = `serverTimestamp()` (Firestore).
 * - `expiresAt` = `now + 7j` (calculé côté Node, `Timestamp.fromMillis()`).
 *   Reset TTL à chaque re-persistance (sliding window, acceptable ici car
 *   l'orchestrateur n'inspecte un article qu'une seule fois par scan).
 * - `passing` est dénormalisé au write pour permettre à `loadPassingArticles`
 *   de query `where("passing", "==", true)` (cf. commentaire du reader).
 * - Mode dégradé : retourne `{ persisted: 0, skipped: 1, reason: "firestore_unavailable" }`.
 * - **Ne throw JAMAIS** : toute erreur catchée → log warn FR + return défaut.
 */
export async function persistExtractedArticle(
  extracted: ExtractedArticle,
  score: ArticleScore,
  scanId: string,
  batchId: string,
  publishedAt: string | null,
): Promise<PersistResult> {
  const db = getAdminDb();
  if (!db) {
    console.warn(`[persistence] Firestore indispo, skip persistance ${extracted.url}`);
    return {
      persisted: 0,
      skipped: 1,
      reason: "firestore_unavailable",
      docId: "",
    };
  }

  // ID déterministe = SHA-256(URL)[:32] hex.
  // Élimine la race condition du pattern "query dedup → set/update" : deux
  // workers concurrents traitant la même URL convergent vers le même id.
  // `setDoc` est idempotent (upsert) → aucun read préalable requis.
  const docId = hashUrl(extracted.url);

  // Calcul expiresAt côté Node. Cohérent pour set ET update (idempotent).
  const now = new Date();
  const expiresAtDate = computeExpiresAt(now);
  const expiresAtTs = Timestamp.fromMillis(expiresAtDate.getTime());

  const payload = {
    url: extracted.url,
    title: extracted.title,
    textContent: extracted.textContent,
    excerpt: extracted.excerpt,
    publishedAt,
    sourceId: extracted.sourceId,
    sourceType: extracted.sourceType,
    score: score.score,
    components: score.components,
    promoScore: score.promoScore,
    rejected: score.rejected,
    ...(score.rejectionReason ? { rejectionReason: score.rejectionReason } : {}),
    // Dénormalisation du flag `passing` : permet à `loadPassingArticles` de
    // query `where("passing", "==", true)` (1 range + 1 equality) au lieu
    // de cumuler `score >=` + `expiresAt >` (2 ranges, interdit par Firestore).
    // Mis à jour à chaque write : reflète l'état courant du seuil.
    passing: computePassing(score.score, score.rejected),
    extractedAt: extracted.extractedAt,
    scoredAt: score.scoredAt,
    scanId,
    batchId,
    persistedAt: serverTimestamp(),
    expiresAt: expiresAtTs,
  };

  try {
    // setDoc idempotent (upsert) : pas de read préalable, pas de race.
    await setDoc(doc(db, RAW_COLLECTION, docId), payload);
    return { persisted: 1, skipped: 0, docId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[persistence] write échoué pour ${extracted.url} : ${message}`);
    return {
      persisted: 0,
      skipped: 1,
      reason: "write_failed",
      docId,
    };
  }
}

/**
 * Hash SHA-256 d'une URL, troncé à 32 hex chars (128 bits, suffisant pour
 * éviter les collisions en pratique sur des millions d'URLs).
 * Retourne un id doc Firestore-compatible (lettres/chiffres uniquement).
 *
 * **Exporté** (story 2-6) pour réutilisation par `auditor.ts` : le writer
 * d'audit doit générer le même `articleId` que `persistExtractedArticle`
 * pour garantir l'idempotence `veille_audit_log` ↔ `veille_raw_articles`
 * sur le même triplet (URL, rejection).
 */
export function hashUrl(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32);
}

// ============================================================================
// Lecture : articles passants
// ============================================================================

/**
 * Charge les articles passants (score >= seuil && !rejected), triés par score
 * décroissant puis par expiresAt asc. Utilisé par le lecteur de structuration
 * Gemini (story 2-5).
 *
 * - Mode dégradé : retourne `[]`.
 * - `limit=0` : retourne `[]` sans query.
 * - Filtre Firestore : `where("passing", "==", true)` + `where("expiresAt", ">", now)`
 *   + `orderBy("score", "desc")` = 1 equality + 1 range + 1 orderBy, autorisé.
 *   Le flag `passing` est dénormalisé au write (cf. `persistExtractedArticle`).
 * - `minScore` filtre côté Node APRÈS le fetch pour rester compatible avec le
 *   seuil runtime (pas de query additive → pas de nouvel index requis si
 *   `minScore` change).
 */
export async function loadPassingArticles(
  limitCount: number = 50,
  minScore: number = PASSING_SCORE_THRESHOLD,
): Promise<VeilleRawArticle[]> {
  if (limitCount <= 0) return [];
  const db = getAdminDb();
  if (!db) {
    console.warn("[persistence] Firestore indispo, loadPassingArticles → []");
    return [];
  }
  try {
    const now = Timestamp.now();
    const q = query(
      db.collection(RAW_COLLECTION),
      where("passing", "==", true),
      where("expiresAt", ">", now),
      orderBy("score", "desc"),
      limit(limitCount * 2), // marge : on filtre `minScore` côté Node après fetch
    );
    const snapshot = await getDocs(q);
    const out: VeilleRawArticle[] = [];
    for (const d of snapshot.docs) {
      if (out.length >= limitCount) break;
      const parsed = docToVeilleRawArticle(d);
      if (!parsed) continue;
      if (parsed.score < minScore) continue;
      out.push(parsed);
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[persistence] loadPassingArticles échoué : ${message}`);
    return [];
  }
}

// ============================================================================
// Purge
// ============================================================================

/**
 * Purge tous les articles expirés (`expiresAt < now`). Lancé par le cron
 * quotidien (server.ts) et l'endpoint admin. Best-effort, jamais throw.
 *
 * - Mode dégradé : retourne `{ purged: 0, durationMs: 0, reason: "firestore_unavailable" }`.
 * - Firestore `writeBatch` limite = 500 writes. Boucle si > 500 docs.
 */
export async function purgeExpiredArticles(): Promise<PurgeResult> {
  const startedAt = Date.now();
  const db = getAdminDb();
  if (!db) {
    console.warn("[persistence] Firestore indispo, purge skipped");
    return { purged: 0, durationMs: 0, reason: "firestore_unavailable" };
  }
  try {
    const now = Timestamp.now();
    const q = query(
      db.collection(RAW_COLLECTION),
      where("expiresAt", "<", now),
      limit(FIRESTORE_BATCH_SIZE * 10), // cap dur : 5000 par run, on reboucle si plus
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return { purged: 0, durationMs: Date.now() - startedAt };
    }
    const docs = snapshot.docs;
    let purged = 0;
    for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_SIZE) {
      const slice = docs.slice(i, i + FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);
      for (const d of slice) {
        batch.delete(d.ref);
      }
      await batch.commit();
      purged += slice.length;
    }
    return { purged, durationMs: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[persistence] purge échouée : ${message}`);
    return { purged: 0, durationMs: Date.now() - startedAt, reason: "purge_failed" };
  }
}

// ============================================================================
// Orchestrateur
// ============================================================================

/**
 * Pool de concurrence maison : lance au plus `cap` promesses en vol, FIFO.
 * Pas de dépendance `p-limit`. Réutilisable story 2-5/2-6.
 */
async function pLimit<T>(items: readonly T[], cap: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx];
      await worker(item);
    }
  }
  const runners = Array.from({ length: Math.min(cap, items.length) }, () => next());
  await Promise.all(runners);
}

/**
 * Orchestrateur principal : pour chaque `ArticleCandidate` :
 *   1. Extract contenu (story 2-2)
 *   2. Score composite (story 2-3)
 *   3. Persiste dans Firestore avec TTL 7j
 *
 * - Charge `reliabilityMap` une seule fois en début de batch (mémoization).
 * - Pool de concurrence cap=5 (anti-Firestore rate limit).
 * - Ne throw JAMAIS : toute erreur catchée localement → compteur `failed`.
 * - Mode dégradé transparent (persistence retourne skipped si Firestore indispo).
 * - `articles=[]` → early return `{persisted: 0, skipped: 0, failed: 0, batchId: ""}`.
 */
export async function extractAndPersistAll(
  articles: readonly ArticleCandidate[],
  scanId: string,
): Promise<BatchResult> {
  if (articles.length === 0) {
    return { persisted: 0, skipped: 0, failed: 0, batchId: "" };
  }

  const batchId = crypto.randomUUID();

  // Charge le cache reliability UNE fois (best-effort, peut être vide en mode dégradé).
  let reliabilityMap: Map<string, number> = new Map();
  try {
    reliabilityMap = await loadReliabilityMap();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[persistence] loadReliabilityMap throw, fallback Map vide : ${message}`);
  }

  let persisted = 0;
  let skipped = 0;
  let failed = 0;

  const worker = async (candidate: ArticleCandidate): Promise<void> => {
    try {
      // 1. Extract contenu (story 2-2).
      const extracted = await extractArticleContent(
        candidate.url,
        candidate.sourceId,
        candidate.sourceType,
        {
          ...(candidate.description ? { description: candidate.description } : {}),
          ...(candidate.title ? { title: candidate.title } : {}),
        },
      );
      if (!extracted) {
        failed++;
        console.warn(`[persistence] extraction échouée pour ${candidate.url}`);
        return;
      }

      // 2. Score composite (story 2-3). Pure, sync, jamais throw.
      // `ScorableArticle` requiert `publishedAt` (string | null) qui n'est pas
      // porté par `ExtractedArticle` : on reconstruit depuis le `candidate`.
      const scorable = {
        url: extracted.url,
        title: extracted.title,
        textContent: extracted.textContent,
        publishedAt: candidate.publishedAt,
        sourceId: extracted.sourceId,
        sourceType: extracted.sourceType,
      };
      const score = scoreArticle(scorable, reliabilityMap, new Date());

      // 3. Persist avec TTL.
      const result = await persistExtractedArticle(
        extracted,
        score,
        scanId,
        batchId,
        candidate.publishedAt,
      );
      if (result.persisted === 1) {
        persisted++;
        // Story 2-6 wire (AC #5) : audite les rejets runtime (persistence)
        // et les articles scorés sous le seuil. Fire-and-forget : l'audit
        // ne doit JAMAIS bloquer la persistance (cf. D-1, Task 4.4).
        if (score.rejected && score.rejectionReason) {
          const reason =
            score.rejectionReason === "empty_content" ? "empty_content" : "promotional_content";
          void auditRejectedArticle(
            {
              articleId: result.docId,
              url: extracted.url,
              reason,
              score: score.score,
            },
            { weekId: `scan-${scanId}`, batchId },
          ).catch(() => {
            // No-op : auditRejectedArticle est garanti no-throw, mais on
            // double le filet `.catch()` contre toute régression future.
          });
        } else if (score.score < PASSING_SCORE_THRESHOLD && !score.rejected) {
          void auditRejectedArticle(
            {
              articleId: result.docId,
              url: extracted.url,
              reason: "below_score",
              score: score.score,
            },
            { weekId: `scan-${scanId}`, batchId },
          ).catch(() => {});
        }
      } else {
        skipped++;
      }
    } catch (err) {
      // Sécurité redondante (extract et score ne sont pas censés throw mais
      // on garantit le contrat "jamais throw vers l'orchestrateur").
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      console.warn(`[persistence] échec pipeline pour ${candidate.url} : ${message}`);
    }
  };

  await pLimit(articles, PERSIST_CONCURRENCY_CAP, worker);

  return { persisted, skipped, failed, batchId };
}
