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
