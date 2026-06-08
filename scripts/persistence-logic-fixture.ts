/**
 * Fixture algorithmique pour la persistance (story 2-4).
 * ATTENTION : ce fichier duplique la logique PURE de persistence.ts
 * (computeExpiresAt, computePassing) pour valider les invariants critiques
 * en l'absence de node_modules (env AI Studio). Risque de drift si la
 * production évolue. Toute divergence entre cette fixture et le code réel
 * doit être corrigée des deux côtés.
 *
 * Exécuter : `npx tsx scripts/persistence-logic-fixture.ts`
 * Pour un vrai test de la prod : `npx tsx scripts/test-persistence.ts`
 * (après `npm install`).
 */

let pass = 0;
let fail = 0;
function expect(label: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label} ${detail}`);
    fail++;
  }
}

const BATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSING_SCORE_THRESHOLD = 60;

// ============================================================================
// computeExpiresAt : now + 7j exacts
// ============================================================================
console.log("\n--- computeExpiresAt ---");
function computeExpiresAt(persistedAt: Date = new Date()): Date {
  return new Date(persistedAt.getTime() + BATCH_RETENTION_MS);
}
{
  const now = new Date("2026-06-04T12:00:00.000Z");
  const exp = computeExpiresAt(now);
  const expIso = exp.toISOString();
  expect(
    `computeExpiresAt(now) = now + 7j exact (got ${expIso})`,
    expIso === "2026-06-11T12:00:00.000Z",
  );
  expect(
    `computeExpiresAt retourne un Date`,
    exp instanceof Date,
  );
  // Différentiel : 604_800_000 ms = 7j exact
  expect(
    `diff computeExpiresAt - now = 7j exact`,
    exp.getTime() - now.getTime() === BATCH_RETENTION_MS,
  );
  // Defaut = new Date() : non-testable stricto sensu (non-déter), mais on
  // vérifie que l'appel sans arg ne throw pas et retourne un Date.
  const exp2 = computeExpiresAt();
  expect(
    `computeExpiresAt() sans arg retourne un Date`,
    exp2 instanceof Date,
  );
  expect(
    `computeExpiresAt() sans arg = now + 7j (cohérent)`,
    Math.abs(exp2.getTime() - Date.now() - BATCH_RETENTION_MS) < 100,
  );
  // Idempotence : si persistedAt == 0 epoch, expiresAt = 7j epoch
  const epoch = new Date(0);
  const expEpoch = computeExpiresAt(epoch);
  expect(
    `computeExpiresAt(epoch) = epoch + BATCH_RETENTION_MS`,
    expEpoch.getTime() === BATCH_RETENTION_MS,
  );
}

// ============================================================================
// computePassing : score >= 60 && !rejected
// ============================================================================
console.log("\n--- computePassing ---");
function computePassing(score: number, rejected: boolean): boolean {
  if (rejected) return false;
  return score >= PASSING_SCORE_THRESHOLD;
}
{
  expect(`score=70, rejected=false → passing=true`, computePassing(70, false) === true);
  expect(`score=60 (frontière incluse), rejected=false → passing=true`, computePassing(60, false) === true);
  expect(`score=59.9 (juste sous), rejected=false → passing=false`, computePassing(59.9, false) === false);
  expect(`score=0, rejected=false → passing=false`, computePassing(0, false) === false);
  expect(`score=100, rejected=false → passing=true`, computePassing(100, false) === true);
  // Rejected domine
  expect(`score=100, rejected=true (promo) → passing=false`, computePassing(100, true) === false);
  expect(`score=60, rejected=true (empty) → passing=false`, computePassing(60, true) === false);
  expect(`score=0, rejected=true → passing=false`, computePassing(0, true) === false);
}

// ============================================================================
// Format ISO 8601 pour scoredAt, extractedAt, publishedAt
// ============================================================================
console.log("\n--- Format ISO 8601 ---");
{
  const sampleDate = new Date("2026-06-04T12:34:56.000Z");
  const iso = sampleDate.toISOString();
  expect(
    `toISOString() = format strict YYYY-MM-DDTHH:MM:SS.sssZ`,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso),
  );
  // Date invalide : Date.parse → NaN → toISOString() throw RangeError.
  // Comportement documenté : on attend une exception, pas une string "Invalid Date".
  const invalid = new Date("not a date");
  let isoThrew = false;
  try {
    invalid.toISOString();
  } catch {
    isoThrew = true;
  }
  expect(
    `Date invalide → toISOString() throw (comportement connu JS)`,
    isoThrew,
  );
}

// ============================================================================
// BATCH_RETENTION_MS : 7 jours en millisecondes
// ============================================================================
console.log("\n--- BATCH_RETENTION_MS ---");
{
  expect(`BATCH_RETENTION_MS = 604_800_000 (7j exacts)`, BATCH_RETENTION_MS === 604_800_000);
  // 7 * 24 * 60 * 60 * 1000 = 7 * 86400000 = 604800000
  expect(`BATCH_RETENTION_MS = 7 × 86400000`, BATCH_RETENTION_MS === 7 * 86400 * 1000);
}

console.log(`\n=========================================`);
console.log(`  ${pass} passés / ${fail} échoués`);
console.log(`=========================================\n`);
if (fail > 0) process.exit(1);
