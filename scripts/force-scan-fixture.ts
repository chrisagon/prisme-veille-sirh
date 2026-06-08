/**
 * Fixture de tests purs pour les helpers story 3.2.
 * Cible : 12/12 tests OK.
 *
 * Usage : `npx tsx scripts/force-scan-fixture.ts`
 */

import {
  computeWeekIdLocal,
  isSundayLateAfternoon,
  isStaleLock,
  STALE_LOCK_THRESHOLD_MS,
} from "../src/server/veille/weekId";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n[${name}]`);
  fn();
}

// === getCurrentWeekId : 5 cas (via computeWeekIdLocal) ===
group("getCurrentWeekId — cohérence", () => {
  // Lundi : début de semaine ISO
  const mon = new Date(Date.UTC(2026, 5, 8));
  assert(computeWeekIdLocal(mon) === "2026-w24", "lundi 8 juin 2026 → 2026-w24", computeWeekIdLocal(mon));

  // Dimanche : même ISO week que le lundi précédent
  const sun = new Date(Date.UTC(2026, 5, 14));
  assert(computeWeekIdLocal(sun) === "2026-w24", "dimanche 14 juin → 2026-w24 (même ISO)", computeWeekIdLocal(sun));

  // Fin d'année (semaine 53)
  const dec31 = new Date(Date.UTC(2026, 11, 31));
  assert(computeWeekIdLocal(dec31) === "2026-w53", "jeudi 31 déc 2026 → 2026-w53", computeWeekIdLocal(dec31));

  // Début d'année suivant
  const jan1 = new Date(Date.UTC(2027, 0, 1));
  const jan1Result = computeWeekIdLocal(jan1);
  // Le 1er jan 2027 est un vendredi → ISO w53 de 2026
  assert(jan1Result === "2026-w53", "vendredi 1er jan 2027 → 2026-w53 (ISO rollover)", jan1Result);

  // DST : on est en UTC, donc pas de surprise
  const dst = new Date(Date.UTC(2026, 2, 29)); // 29 mars 2026 (DST EU)
  const dstResult = computeWeekIdLocal(dst);
  assert(dstResult === "2026-w13", "dimanche 29 mars 2026 (DST EU) → 2026-w13 (UTC stable)", dstResult);
});

// === isSundayLateAfternoon : 4 cas ===
group("isSundayLateAfternoon", () => {
  // Dimanche 23h30 UTC → true
  const sunLate = new Date(Date.UTC(2026, 5, 14, 23, 30));
  assert(isSundayLateAfternoon(sunLate) === true, "dimanche 14 juin 2026 23h30 UTC → true", isSundayLateAfternoon(sunLate).toString());

  // Dimanche 22h59 UTC → false (avant 23h)
  const sunEarly = new Date(Date.UTC(2026, 5, 14, 22, 59));
  assert(isSundayLateAfternoon(sunEarly) === false, "dimanche 14 juin 2026 22h59 UTC → false", isSundayLateAfternoon(sunEarly).toString());

  // Lundi 23h30 UTC → false (mauvais jour)
  const monLate = new Date(Date.UTC(2026, 5, 15, 23, 30));
  assert(isSundayLateAfternoon(monLate) === false, "lundi 15 juin 2026 23h30 UTC → false", isSundayLateAfternoon(monLate).toString());

  // Dimanche 23h00 UTC → true (limite basse inclusive)
  const sun2300 = new Date(Date.UTC(2026, 5, 14, 23, 0));
  assert(isSundayLateAfternoon(sun2300) === true, "dimanche 14 juin 2026 23h00 UTC → true (limite inclusive)", isSundayLateAfternoon(sun2300).toString());
});

// === isStaleLock : 3 cas ===
group("isStaleLock", () => {
  // Heartbeat vieux de 11 min → stale
  const now = 1_700_000_000_000;
  const oldHeartbeat = now - 11 * 60 * 1000;
  assert(isStaleLock(oldHeartbeat, now) === true, "heartbeat 11min → true (stale)", isStaleLock(oldHeartbeat, now).toString());

  // Heartbeat vieux de 9 min → frais
  const freshHeartbeat = now - 9 * 60 * 1000;
  assert(isStaleLock(freshHeartbeat, now) === false, "heartbeat 9min → false (frais)", isStaleLock(freshHeartbeat, now).toString());

  // Heartbeat à la limite exacte (10 min) → non stale (= pas strictement >)
  const edgeHeartbeat = now - STALE_LOCK_THRESHOLD_MS;
  assert(isStaleLock(edgeHeartbeat, now) === false, "heartbeat exactement 10min → false (limite inclusive)", isStaleLock(edgeHeartbeat, now).toString());
});

// === Résumé ===
console.log(`\n=== Résultat : ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error("FAIL");
  process.exit(1);
}
console.log("OK");
process.exit(0);
