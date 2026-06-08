/**
 * Helpers ISO week pour la récupération de rapport (story 3.1) et le
 * scheduling per-source (story 3.4).
 *
 * Format canonique aligné sur `structurer.ts:computeWeekId` : `YYYY-wN`
 * (lowercase `w`). Le `N` est 1-53 (ISO 8601 autorise w53).
 *
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2)
 * Cf. _bmad-output/implementation-artifacts/3-1-endpoint-api-de-recuperation-du-rapport-hebdomadaire.md
 */

const WEEK_ID_REGEX = /^\d{4}-w([1-9]|[1-4][0-9]|5[0-3])$/;

/**
 * Parse un weekId `YYYY-wN`. Retourne `{ year, week }` ou `null` si invalide.
 * Pure, déterministe.
 */
export function parseWeekId(weekId: unknown): { year: number; week: number } | null {
  if (typeof weekId !== "string") return null;
  if (!WEEK_ID_REGEX.test(weekId)) return null;
  const [yearStr, weekPart] = weekId.split("-w");
  const year = Number.parseInt(yearStr!, 10);
  const week = Number.parseInt(weekPart!, 10);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  return { year, week };
}

/**
 * Calcule le weekId courant (`YYYY-wN`) pour la date donnée.
 * Wrapper de `structurer.computeWeekId` pour usage depuis l'API
 * (story 3.2 force-scan aura besoin de `getCurrentWeekId`).
 *
 * On importe dynamiquement pour éviter un cycle potentiel
 * (structurer.ts importe déjà des types veille).
 */
export async function getCurrentWeekId(): Promise<string> {
  const { computeWeekId } = await import("./structurer");
  return computeWeekId(new Date());
}

/**
 * Helper : calcule le weekId directement en synchrone. Évite l'import
 * dynamique de `computeWeekId` pour les tests et les cas non-async.
 * Réimplémentation compacte, alignée sur structurer.ts:109-124.
 */
export function computeWeekIdLocal(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const clamped = Math.max(1, Math.min(53, weekNum));
  return `${d.getUTCFullYear()}-w${clamped}`;
}

// ============================================================================
// Story 3.2 helpers : scheduling per-source + lock staleness
// ============================================================================

/** Lock considéré stale si dernier heartbeat > 10 min. */
export const STALE_LOCK_THRESHOLD_MS = 10 * 60 * 1000;

/** Plage horaire "dimanche soir" où le cron va tourner (23h00-23h59). */
export const SUNDAY_LATE_HOUR_START = 23;
export const SUNDAY_LATE_HOUR_END = 23;
export const SUNDAY_DAY = 0; // 0 = dimanche en getUTCDay()

/**
 * Helper : détecte si on est dimanche entre 23h00 et 23h59 UTC.
 * Utilisé par le force-scan pour éviter de doubler avec le cron hebdo.
 *
 * @param date Date à tester (par défaut `new Date()`)
 * @returns `true` si dimanche 23h00-23h59 UTC
 */
export function isSundayLateAfternoon(date: Date = new Date()): boolean {
  return date.getUTCDay() === SUNDAY_DAY && date.getUTCHours() >= SUNDAY_LATE_HOUR_START;
}

/**
 * Helper : détermine si un lock (basé sur son dernier heartbeat) est stale.
 * Utilisé par le force-scan pour reprendre un lock abandonné par un crash.
 *
 * @param lastHeartbeatMs Timestamp Unix (ms) du dernier heartbeat
 * @param nowTs Timestamp de référence (par défaut `Date.now()`)
 * @returns `true` si le lock est stale (> STALE_LOCK_THRESHOLD_MS sans heartbeat)
 */
export function isStaleLock(lastHeartbeatMs: number, nowTs: number = Date.now()): boolean {
  return nowTs - lastHeartbeatMs > STALE_LOCK_THRESHOLD_MS;
}
