/**
 * Service de récupération des rapports structurés depuis Firestore
 * (story 3.1 — Intégration au flux de rapport existant).
 *
 * Responsabilités :
 * - Charger un rapport depuis `reports/{weekId}` via Admin SDK
 * - Valider la forme du `VeilleReport` retourné (anti-corruption)
 * - Cache mémoire TTL 5min (invalidation via `invalidateReportCache`)
 *
 * Mode dégradé (Firestore indispo) : `loadReportFromFirestore` retourne
 * `null` sans throw — le caller (route handler) map vers status 200 +
 * `firestore_unavailable` côté client.
 *
 * Pas de throw : tout catch → log warn FR + return null.
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-6)
 * Cf. _bmad-output/implementation-artifacts/3-1-endpoint-api-de-recuperation-du-rapport-hebdomadaire.md
 */

import { doc, getDoc } from "../lib/firestoreCompat";
import { getAdminDb } from "../firebaseAdmin";
import type { VeilleReport } from "../../data/defaultReports";
import { parseWeekId } from "./weekId";

/** Nom de la collection Firestore (cf. structurer.ts:55 — REPORTS_COLLECTION). */
const REPORTS_COLLECTION = "reports";

/** TTL du cache mémoire (5 min) — évite le re-fetch à chaque GET si l'UI poll. */
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedReport {
  report: VeilleReport;
  cachedAt: number;
}

const reportCache: Map<string, CachedReport> = new Map();

/**
 * Charge un rapport structuré depuis `reports/{weekId}`.
 * - `weekId` doit être au format `YYYY-wN` (cf. `parseWeekId`)
 * - Le doc Firestore a la forme `{ report: VeilleReport, weekId, generatedAt, ... }`
 * - Cache mémoire TTL 5min (clé = weekId)
 * - Retourne `null` si :
 *   - weekId invalide
 *   - doc inexistant
 *   - Firestore indispo (mode dégradé)
 *   - shape de `report` invalide (corruption)
 *
 * **Ne throw jamais.** Erreurs catchées + log warn + return null.
 */
export async function loadReportFromFirestore(
  weekId: string,
): Promise<VeilleReport | null> {
  // 1. Validation weekId (anti-injection côté path Firestore)
  if (parseWeekId(weekId) === null) {
    console.warn(`[rapport] loadReportFromFirestore weekId invalide : ${weekId}`);
    return null;
  }

  // 2. Cache hit
  const cached = reportCache.get(weekId);
  if (cached && Date.now() - cached.cachedAt < REPORT_CACHE_TTL_MS) {
    return cached.report;
  }

  // 3. Firestore fetch
  const db = getAdminDb();
  if (!db) {
    console.warn(`[rapport] Firestore indispo, retour null pour weekId=${weekId}`);
    return null;
  }

  try {
    const snap = await getDoc(doc(db, REPORTS_COLLECTION, weekId));
    if (!snap.exists) {
      console.log(`[rapport] aucun rapport pour weekId=${weekId}`);
      return null;
    }
    const data = snap.data();
    const report = data?.report as unknown;
    if (!isValidReportShape(report)) {
      console.warn(`[rapport] rapport corrompu pour weekId=${weekId} (shape invalide)`);
      return null;
    }
    // Cache write
    reportCache.set(weekId, { report, cachedAt: Date.now() });
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[rapport] lecture Firestore échouée weekId=${weekId} : ${message}`);
    return null;
  }
}

/**
 * Invalide l'entrée de cache pour un `weekId` donné.
 * À appeler après un `writeReport` (story 3.2) pour forcer re-fetch.
 */
export function invalidateReportCache(weekId: string): void {
  reportCache.delete(weekId);
}

/**
 * Vide entièrement le cache. Utile pour les tests et le debug manuel.
 */
export function clearReportCache(): void {
  reportCache.clear();
}

/**
 * Validation runtime de la forme `VeilleReport`.
 * Pure, déterministe. Tolère `actualites.length` entre 5 et 7 (compat
 * legacy Gemini 7 actus vs spec actuelle 5 actus, cf. SPEC C6).
 *
 * Retourne `true` si l'objet passé a la forme minimale requise.
 */
export function isValidReportShape(obj: unknown): obj is VeilleReport {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>;

  // top3 : 3 strings non-vides
  if (!Array.isArray(r.top3) || r.top3.length !== 3) return false;
  if (!r.top3.every((s) => typeof s === "string" && s.length > 0)) return false;

  // actualites : 5 ou 7 items avec champs requis non-vides
  if (!Array.isArray(r.actualites)) return false;
  if (r.actualites.length !== 5 && r.actualites.length !== 7) return false;
  const allActusValid = r.actualites.every((a) => {
    if (!a || typeof a !== "object") return false;
    const act = a as Record<string, unknown>;
    return (
      typeof act.title === "string" && act.title.length > 0 &&
      typeof act.source === "string" && act.source.length > 0 &&
      typeof act.date === "string" && act.date.length > 0 &&
      typeof act.summary === "string" && act.summary.length > 0
      // url est optionnel dans le type, mais les actus legacy ont toujours url
      // On ne le rend pas required ici pour tolérer le format legacy
    );
  });
  if (!allActusValid) return false;

  // mouvements, reglementation, ressources, actions : arrays (peuvent être vides)
  if (!Array.isArray(r.mouvements)) return false;
  if (!Array.isArray(r.reglementation)) return false;
  if (!Array.isArray(r.ressources)) return false;
  if (!Array.isArray(r.actions)) return false;

  // chiffre, signalFaible : objet ou null
  if (r.chiffre !== null && typeof r.chiffre !== "object") return false;
  if (r.signalFaible !== null && typeof r.signalFaible !== "object") return false;

  return true;
}
