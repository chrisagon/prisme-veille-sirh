/**
 * Fixture de tests purs pour les helpers ISO week (story 3.1).
 * Cible : 15/15 tests OK.
 *
 * Usage : `npx tsx scripts/rapport-api-fixture.ts`
 * Pas de framework : on log des PASS/FAIL et on exit 1 si une assertion
 * échoue. Cf. scripts/auditor-logic-fixture.ts pour le pattern.
 */

import { parseWeekId, computeWeekIdLocal } from "../src/server/veille/weekId";
import { isValidReportShape } from "../src/server/veille/rapport";

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

// === parseWeekId : cas valides (4 cas) ===
group("parseWeekId — cas valides", () => {
  const r1 = parseWeekId("2026-w23");
  assert(r1 !== null, "2026-w23 parse");
  assert(r1?.year === 2026 && r1?.week === 23, "2026-w23 → { year: 2026, week: 23 }", JSON.stringify(r1));

  const r2 = parseWeekId("2025-w1");
  assert(r2?.year === 2025 && r2?.week === 1, "2025-w1 → { year: 2025, week: 1 }", JSON.stringify(r2));

  const r3 = parseWeekId("2026-w53");
  assert(r3?.year === 2026 && r3?.week === 53, "2026-w53 → { year: 2026, week: 53 } (limite haute ISO)", JSON.stringify(r3));

  const r4 = parseWeekId("2026-w10");
  assert(r4?.year === 2026 && r4?.week === 10, "2026-w10 → { year: 2026, week: 10 } (cas intermédiaire)", JSON.stringify(r4));
});

// === parseWeekId : cas invalides (5 cas) ===
group("parseWeekId — cas invalides", () => {
  assert(parseWeekId("invalid") === null, "string non-conforme → null");
  assert(parseWeekId("") === null, "chaîne vide → null");
  assert(parseWeekId(null) === null, "null → null");
  assert(parseWeekId("2026-23") === null, "format sans -w → null");
  assert(parseWeekId("W23") === null, "W23 sans année → null");
});

// === computeWeekIdLocal : cas de cohérence (3 cas) ===
group("computeWeekIdLocal — cohérence structurer.ts", () => {
  // Lundi 8 juin 2026 = ISO w24
  const monday = new Date(Date.UTC(2026, 5, 8));
  assert(computeWeekIdLocal(monday) === "2026-w24", "lundi 8 juin 2026 → 2026-w24", computeWeekIdLocal(monday));

  // Dimanche 14 juin 2026 = ISO w24 (mêmes semaine ISO)
  const sunday = new Date(Date.UTC(2026, 5, 14));
  assert(computeWeekIdLocal(sunday) === "2026-w24", "dimanche 14 juin 2026 → 2026-w24 (même ISO week)", computeWeekIdLocal(sunday));

  // Lundi 29 décembre 2025 = ISO w1 de 2026 (car le jeudi tombe le 1er jan 2026)
  const dec29 = new Date(Date.UTC(2025, 11, 29));
  const result = computeWeekIdLocal(dec29);
  // ISO 8601: lundi 29 déc 2025 fait partie de la semaine 1 de 2026 (jeudi = 1er jan 2026)
  assert(result === "2026-w1", "lundi 29 déc 2025 → 2026-w1 (ISO rollover)", result);
});

// === parseWeekId + computeWeekIdLocal : round-trip (3 cas) ===
group("round-trip parseWeekId ↔ computeWeekIdLocal", () => {
  const dates = [
    new Date(Date.UTC(2026, 0, 5)),   // lundi 5 jan 2026 → 2026-w2
    new Date(Date.UTC(2026, 5, 15)),  // lundi 15 juin 2026 → 2026-w25
    new Date(Date.UTC(2026, 11, 31)), // jeudi 31 déc 2026 → 2026-w53
  ];
  for (const date of dates) {
    const weekId = computeWeekIdLocal(date);
    const parsed = parseWeekId(weekId);
    assert(parsed !== null, `${date.toISOString()} → ${weekId} parse OK`);
  }
});

// === isValidReportShape : 6 cas ===
group("isValidReportShape", () => {
  // Cas 1 : rapport valide 5 actus
  const valid5 = {
    top3: ["a", "b", "c"],
    actualites: [
      { title: "t1", source: "s1", date: "2026-06-01", summary: "sum1" },
      { title: "t2", source: "s2", date: "2026-06-02", summary: "sum2" },
      { title: "t3", source: "s3", date: "2026-06-03", summary: "sum3" },
      { title: "t4", source: "s4", date: "2026-06-04", summary: "sum4" },
      { title: "t5", source: "s5", date: "2026-06-05", summary: "sum5" },
    ],
    mouvements: [],
    reglementation: [],
    ressources: [],
    actions: [],
    chiffre: null,
    signalFaible: null,
  };
  assert(isValidReportShape(valid5), "rapport valide 5 actus → true");

  // Cas 2 : rapport valide 7 actus (legacy Gemini)
  const valid7 = { ...valid5, actualites: [...valid5.actualites, { title: "t6", source: "s6", date: "2026-06-06", summary: "sum6" }, { title: "t7", source: "s7", date: "2026-06-07", summary: "sum7" }] };
  assert(isValidReportShape(valid7), "rapport valide 7 actus (legacy) → true");

  // Cas 3 : top3 incomplet
  const noTop3 = { ...valid5, top3: ["a", "b"] };
  assert(!isValidReportShape(noTop3), "top3 < 3 items → false");

  // Cas 4 : actualites count invalide (4 items)
  const wrongCount = { ...valid5, actualites: valid5.actualites.slice(0, 4) };
  assert(!isValidReportShape(wrongCount), "actualites.length === 4 → false");

  // Cas 5 : actualite avec title vide
  const emptyTitle = { ...valid5, actualites: [{ ...valid5.actualites[0], title: "" }, ...valid5.actualites.slice(1)] };
  assert(!isValidReportShape(emptyTitle), "actualité avec title vide → false");

  // Cas 6 : pas un objet
  assert(!isValidReportShape(null), "null → false");
  assert(!isValidReportShape("string"), "string → false");
  assert(!isValidReportShape({}), "objet vide → false");
});

// === Résumé ===
console.log(`\n=== Résultat : ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error("FAIL");
  process.exit(1);
}
console.log("OK");
process.exit(0);
