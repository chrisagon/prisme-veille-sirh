/**
 * Service d'audit du pipeline de veille (story 2-6 — CAP-5 spec veille
 * automatique). Journalise dans `veille_audit_log` chaque exclusion d'article
 * (URL absente, source non vérifiable, score sous seuil, contenu vide,
 * promotionnel). Permet la traçabilité post-mortem et la mesure de C0
 * (zéro hallucination).
 *
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md CAP-5
 * Cf. _bmad-output/implementation-artifacts/2-6-citation-verifiable-et-log-d-audit.md
 *
 * Responsabilités :
 * - Helper pur `buildAuditDocId` (idempotent, déterministe, sanitisé).
 * - Helper pur `isValidRejectionReason` (defense in depth contre enum drift).
 * - Helper pur `isUnverifiable` (cross-référence corpus vs Gemini output).
 * - Helper pur `filterByReason` (admin endpoint query).
 * - Writer `auditRejectedArticle` (fire-and-forget, mode dégradé C4).
 *
 * Patterns respectés (cf. stories 2-1 → 2-5) :
 * - `getAdminDb()` exclusivement (jamais `adminDb` direct).
 * - Pas de throw : tout catch → log warn FR + return void (C4 strict).
 * - Logs en français (C3) avec contexte `[auditor]`.
 * - Mode dégradé (Firestore indispo) transparent.
 * - `serverTimestamp()` côté Firestore pour horodatage cohérent.
 * - `crypto.randomUUID()` natif Node 18+ pour fallback `articleId`.
 *
 * C0 enforcement :
 * - L'audit est la **mesure** de C0 : un rapport avec N rejets `missing_url`
 *   ou `unverifiable_source` = N actualités écartées par les guard-fous.
 * - Le `docId` est idempotent : un même triplet (weekId, articleId, reason)
 *   écrasé silencieusement. Volontaire.
 *
 * D-1 (fire-and-forget) : le caller ne doit PAS `await` `auditRejectedArticle`.
 *   Si Firestore est lent, le rapport doit quand même sortir. Pattern
 *   obligatoire : `void auditRejectedArticle(entry, ctx).catch(() => {})`.
 */

import { doc, serverTimestamp, setDoc } from "../lib/firestoreCompat";
import type { Timestamp as FirestoreTimestamp } from "firebase-admin/firestore";
export { Timestamp } from "../lib/firestoreCompat";
import { getAdminDb } from "../firebaseAdmin";

// ============================================================================
// Constantes
// ============================================================================

/** Nom de la collection Firestore (cf. AC #6, AC #8). */
export const AUDIT_COLLECTION = "veille_audit_log";

/** Codes d'erreur Firebase considérés comme "indispo" pour mode dégradé. */
const FIRESTORE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "unavailable",
  "deadline-exceeded",
  "internal",
  "resource-exhausted",
]);

// ============================================================================
// Types exportés
// ============================================================================

/**
 * Raisons valides de rejet d'un article (cf. AC #2).
 * 5 valeurs effectivement produites par le pipeline (cf. AC #5 wire structurer
 * + AC #5 wire persistence). Volontairement restreint : aucune story ne
 * produit `low_corroboration` ou `duplicate` (retirés du spec post-review).
 */
export type AuditRejectionReason =
  | "missing_url"
  | "below_score"
  | "unverifiable_source"
  | "empty_content"
  | "promotional_content";

const REJECTION_REASONS: ReadonlySet<AuditRejectionReason> = new Set([
  "missing_url",
  "below_score",
  "unverifiable_source",
  "empty_content",
  "promotional_content",
]);

/**
 * Forme d'une entrée d'audit (cf. AC #2).
 * - `articleId` : doc id déterministe (hashUrl) ou UUID v4 si URL absente.
 * - `url` : optionnelle (peut être absente pour `missing_url`).
 * - `reason` : 1 des 5 valeurs énumérées.
 * - `rejectedAt` : input-optional, output-toujours server-stampé côté write.
 * - `score`, `batchId`, `weekId` : contexte optionnel de corrélation.
 */
export interface AuditLogEntry {
  articleId: string;
  url?: string;
  reason: AuditRejectionReason;
  rejectedAt?: FirestoreTimestamp | null;
  score?: number;
  batchId?: string;
  weekId?: string;
}

// ============================================================================
// Helpers purs (testables, sans Firebase)
// ============================================================================

/**
 * Construit un doc id Firestore-compatible pour une entrée d'audit.
 * Format : `${weekId}__${articleId}__${reason}`. Idempotent : un même
 * triplet produit toujours le même id → `setDoc` upsert.
 *
 * **Injectivité** (cf. D-3) : chaque segment est sanitisé pour strip le
 * séparateur `__` (remplacé par `_`). Évite les collisions du type
 * `(w="a",art="b__c",r="r")` ≡ `(w="a__b",art="c",r="r")`.
 *
 * Caractères autorisés dans chaque segment : alphanumériques + `_` + `-`.
 * Tout autre caractère est remplacé par `_` (assainit les sources externes
 * non-trusted comme Gemini, hackers si rules cassées).
 */
export function buildAuditDocId(
  weekId: string,
  articleId: string,
  reason: string,
): string {
  const sanitize = (s: string): string =>
    s.replace(/__/g, "_").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${sanitize(weekId)}__${sanitize(articleId)}__${sanitize(reason)}`;
}

/**
 * Type guard : valide qu'une chaîne est une `AuditRejectionReason` connue.
 * Defense in depth contre raison invalide injectée par un caller
 * (Gemini output corrompu, endpoint admin mal-paramétré, etc.).
 */
export function isValidRejectionReason(reason: string): reason is AuditRejectionReason {
  return REJECTION_REASONS.has(reason as AuditRejectionReason);
}

/**
 * Cross-référence : détermine si une actualité pointée par Gemini est
 * vérifiable (URL présente dans le corpus scanné). Pure, O(1) via `Set.has`.
 *
 * **Convention** : `corpusUrls` est construit côté caller par
 * `loadPassingArticles(...).map(a => normalizeUrl(a.url))`. URLs non
 * normalisées côté corpus = faux positifs. La normalisation est faite
 * par `normalizeUrl` (exporté depuis `structurer.ts`).
 */
export function isUnverifiable(
  actualiteUrl: string,
  corpusUrls: ReadonlySet<string>,
): boolean {
  if (!actualiteUrl || actualiteUrl.length === 0) return true;
  if (corpusUrls.size === 0) return true; // corpus vide → tout unverifiable
  return !corpusUrls.has(actualiteUrl);
}

/**
 * Filtre une liste d'entrées par raison. Helper utilisé par l'endpoint
 * admin (Task 5). Pure, générique, testable.
 */
export function filterByReason<T extends { reason: string }>(
  entries: readonly T[],
  reason: string,
): T[] {
  return entries.filter((e) => e.reason === reason);
}

// ============================================================================
// Writer (async, fire-and-forget, mode dégradé)
// ============================================================================

/**
 * Journalise un rejet d'article dans `veille_audit_log`. Fire-and-forget :
 *
 * - Le caller DOIT utiliser `void auditRejectedArticle(entry, ctx).catch(() => {})`
 *   (cf. Task 3.6, Don't-Miss Rules).
 * - Ne throw JAMAIS : tout catch → log warn FR + return void.
 * - Mode dégradé (Firestore indispo) : log warn + return. Le pipeline
 *   continue, le rapport sort, l'admin perd juste la traçabilité de ce
 *   rejet spécifique (warning explicite dans les logs).
 * - Idempotent : `setDoc` sur `${weekId}__${articleId}__${reason}`. Deux
 *   audits du même triplet = upsert silencieux.
 *
 * @param entry Forme d'entrée validée runtime (defense in depth).
 * @param context Contexte de corrélation (weekId du rapport, batchId du scan).
 */
export async function auditRejectedArticle(
  entry: AuditLogEntry,
  context?: { weekId?: string; batchId?: string },
): Promise<void> {
  // Defense in depth 1 : articleId requis et non-vide.
  if (!entry.articleId || entry.articleId.length === 0) {
    console.warn(`[auditor] entry.articleId manquant, audit skip`);
    return;
  }

  // Defense in depth 2 : reason valide (rejette enum drift).
  if (!isValidRejectionReason(entry.reason)) {
    console.warn(
      `[auditor] reason invalide "${entry.reason}" pour articleId=${entry.articleId}, audit skip`,
    );
    return;
  }

  // Mode dégradé : Firestore indispo.
  const db = getAdminDb();
  if (!db) {
    console.warn(
      `[auditor] Firestore indispo, audit skip reason=${entry.reason} articleId=${entry.articleId}`,
    );
    return;
  }

  // Id doc déterministe = `${weekId}__${articleId}__${reason}`.
  const docId = buildAuditDocId(
    context?.weekId ?? "no-week",
    entry.articleId,
    entry.reason,
  );

  try {
    await setDoc(doc(db, AUDIT_COLLECTION, docId), {
      articleId: entry.articleId,
      ...(entry.url !== undefined ? { url: entry.url } : {}),
      reason: entry.reason,
      score: entry.score ?? null,
      batchId: context?.batchId ?? entry.batchId ?? null,
      weekId: context?.weekId ?? entry.weekId ?? null,
      rejectedAt: serverTimestamp(),
    });
  } catch (err) {
    // Mode dégradé persistant : on ne remonte JAMAIS l'erreur (C4).
    // Le caller ne peut pas try/catch autour — la fonction n'échoue pas.
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "unknown";
    const isUnavailable = FIRESTORE_UNAVAILABLE_CODES.has(code);
    const detail = isUnavailable
      ? "Firestore indispo"
      : "erreur Firestore inattendue";
    console.warn(
      `[auditor] ${detail}, audit skip reason=${entry.reason} articleId=${entry.articleId} code=${code} message=${message}`,
    );
  }
}

/**
 * Re-export du type `Timestamp` côté value-class (alias pour usage futur
 * par endpoint admin AC #7). Pattern story 2-5 : éviter le conflit entre
 * le type `Timestamp` (value-class) et `FirestoreTimestamp` (type export).
 */
export { Timestamp };
