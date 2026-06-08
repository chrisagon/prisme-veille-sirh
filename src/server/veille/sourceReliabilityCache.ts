/**
 * Cache mémoire du score de fiabilité des sources (VeilleSource.reliabilityScore).
 * Cf. _bmad-output/implementation-artifacts/2-3-scoring-de-pertinence-composite.md (AC #4)
 *
 * Le scorer reçoit ce cache déjà chargé. Le caller (orchestrateur futur story 2-4)
 * est responsable de :
 *   1. Charger le cache UNE FOIS en début de batch de scoring.
 *   2. Rejeter/recharger le cache si le batch dure trop longtemps (TTL recommandé : 5 min).
 *
 * En mode dégradé (Firestore indispo), le cache est vide et toutes les sources
 * obtiennent `sourceReliability = 0.5` (neutre) — pas de pénalisation abusive.
 *
 * Anti-hallucination (C0) : pas de LLM, lecture directe du champ documentaire.
 */

import { getAdminDb } from "../firebaseAdmin";
import { VeilleSource } from "../../types/veille";
import { DEFAULT_RELIABILITY_HIGH } from "../../types/veille";

const SOURCES_COLLECTION = "veille_sources";

/**
 * Charge le mapping `sourceId → reliabilityScore` depuis Firestore.
 *
 * - Mode dégradé (`getAdminDb() === null`) : retourne `Map` vide.
 * - Erreur de lecture : retourne `Map` vide + log warn (le scoring reste opérationnel
 *   avec fallback `0.5`).
 * - Champ `reliabilityScore` absent sur un doc : fallback `DEFAULT_RELIABILITY_HIGH = 85`
 *   (sources éditoriales par défaut). Cohérent avec `firestore.rules:isValidVeilleSource`.
 *   Note : on distingue "doc sans champ" (fallback 85) de "source absente du cache"
 *   (fallback 0.5 dans `getReliability`) — le premier cas reflète un admin qui n'a
 *   pas encore évalué, le second une source inconnue ou un Firestore indispo.
 */
export async function loadReliabilityMap(): Promise<Map<string, number>> {
  const db = getAdminDb();
  const cache = new Map<string, number>();
  if (!db) {
    // Mode dégradé silencieux : le log warning est déjà émis par `getAdminDb`/init.
    return cache;
  }
  try {
    const snapshot = await db.collection(SOURCES_COLLECTION).get();
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Partial<VeilleSource>;
      // F03 : `typeof NaN === "number"`, `Number.isFinite` filtre NaN/Infinity.
      const rawScore = data.reliabilityScore;
      const score = typeof rawScore === "number" && Number.isFinite(rawScore)
        ? rawScore
        : DEFAULT_RELIABILITY_HIGH;
      // Clamp [0, 100] pour robustesse (données corrompues hors NaN).
      const clamped = Math.max(0, Math.min(100, score));
      cache.set(docSnap.id, clamped);
    }
    return cache;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sourceReliabilityCache] lecture Firestore échouée, fallback Map vide : ${message}`);
    return cache;
  }
}

/**
 * Convertit un `reliabilityScore` (0-100) en composante normalisée (0-1).
 *
 * - source absente du cache (Firestore indispo ou source inconnue) → 0.5 (neutre)
 * - score 0 → 0.0 (rejet éditorial)
 * - score 100 → 1.0
 * - sinon : score / 100
 * - score NaN/Infinity (corruption défensive) → 0.5 (neutre)
 *
 * NB : `DEFAULT_RELIABILITY_HIGH = 85` → 0.85 (fiable).
 */
export function getReliability(
  sourceId: string,
  cache: Map<string, number>,
): number {
  if (!cache.has(sourceId)) return 0.5;
  const score = cache.get(sourceId) ?? 0;
  if (!Number.isFinite(score)) return 0.5;
  return score / 100;
}
