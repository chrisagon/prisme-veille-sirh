/**
 * Smoke test manual pour story 2-3 (scoring composite).
 * Exécuter : `npx tsx scripts/test-scorer.ts`
 * (Validation utilisateur — pas de framework de test installé.)
 */

import { scoreArticle } from "../src/server/veille/scorer";
import type { ScorableArticle } from "../src/server/veille/types";
import { countKeywordMatches, countPromoMarkers, SIRH_IA_KEYWORDS, PROMO_MARKERS } from "../src/server/veille/keywords";
import { getReliability, loadReliabilityMap } from "../src/server/veille/sourceReliabilityCache";

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

const reliableSourceCache = new Map<string, number>([
  ["src-a", 85],   // 0.85 → composante 25.5/30
  ["src-b", 50],   // 0.5  → composante 15/30
  ["src-c", 0],    // 0    → composante 0/30
  // src-missing absent → 0.5 (neutre)
]);

// ============================================================================
// Tests keywords.ts
// ============================================================================
console.log("\n--- keywords.ts ---");
{
  const rpsInText = countKeywordMatches("Les RPS au travail sont un sujet majeur", SIRH_IA_KEYWORDS);
  expect("RPS matche dans 'Les RPS au travail'", rpsInText.includes("RPS"));
  const rpsInGrps = countKeywordMatches("Le sigle GRPS est utilisé", SIRH_IA_KEYWORDS);
  expect("RPS ne matche PAS dans 'GRPS' (word-boundary)", !rpsInGrps.includes("RPS"));
  const iaInDial = countKeywordMatches("Le DIAL est ouvert", SIRH_IA_KEYWORDS);
  expect("IA ne matche PAS dans 'DIAL' (word-boundary)", !iaInDial.includes("IA"));
  const evalAccent = countKeywordMatches("Une évaluation annuelle est prévue", SIRH_IA_KEYWORDS);
  expect("évaluation matche (accent-insensitive)", evalAccent.includes("évaluation"));
  const evalNoAccent = countKeywordMatches("L'evaluation du personnel", SIRH_IA_KEYWORDS);
  expect("évaluation matche aussi dans 'evaluation' (NFD strip)", evalNoAccent.includes("évaluation"));
  const promoContact = countPromoMarkers("Contactez-nous pour en savoir plus", PROMO_MARKERS);
  expect("contactez-nous matche (case-insensitive)", promoContact.includes("contactez-nous"));
  const promoRecontact = countPromoMarkers("Veuillez recontactez-nous", PROMO_MARKERS);
  expect("contactez-nous matche dans recontactez (substring)", promoRecontact.includes("contactez-nous"));
}

// ============================================================================
// Tests scorer.ts
// ============================================================================
console.log("\n--- scorer.ts ---");
{
  // Article "idéal" : 5+ keywords, source fiable, publié il y a 1h, 0 promo.
  const ideal: ScorableArticle = {
    url: "https://example.com/ia-sirh",
    title: "L'IA générative et le SIRH : révolution de la paie",
    textContent: "L'intelligence artificielle transforme le SIRH, la paie, le recrutement, la formation, l'évaluation, les talents. Le LLM et le machine learning automatisent la paie. Le RGPD encadre. La CNIL veille. QVT, RPS, bien-être au travail, marque employeur, marque employeur.",
    publishedAt: new Date(Date.now() - (1 * 60 * 60 * 1000)).toISOString(), // 1h
    sourceId: "src-a",
    sourceType: "rss",
  };
  const r = scoreArticle(ideal, reliableSourceCache);
  expect(`Article idéal score >= 85 (got ${r.score})`, r.score >= 85);
  expect(`Article idéal rejected=false`, r.rejected === false);
  expect(`Article idéal recency ≈ 1.0 (got ${r.components.recency})`, r.components.recency >= 0.95);
  expect(`Article idéal sourceReliability ≈ 0.85 (got ${r.components.sourceReliability})`,
    Math.abs(r.components.sourceReliability - 0.85) < 0.01);

  // Article rejeté : promoScore > 40.
  const promo: ScorableArticle = {
    url: "https://example.com/promo",
    title: "Solution clé en main pour votre SIRH",
    textContent: "Nous proposons une solution clé en main. Demandez une démo. Contactez-nous. Essai gratuit. Offre limitée. Réduction exclusive. Téléchargez maintenant. Abonnez-vous.",
    publishedAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
    sourceId: "src-a",
    sourceType: "rss",
  };
  const rp = scoreArticle(promo, reliableSourceCache);
  expect(`Article promo rejected=true (promoScore=${rp.promoScore})`, rp.rejected === true);
  expect(`Article promo score=0 (got ${rp.score})`, rp.score === 0);
  expect(`Article promo rejectionReason=promotional_content`, rp.rejectionReason === "promotional_content");

  // Article limite (score ~ 60).
  const lim: ScorableArticle = {
    url: "https://example.com/limite",
    title: "Recrutement et SIRH",
    textContent: "Le recrutement moderne s'appuie sur le SIRH et l'évaluation. La formation continue.",
    publishedAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString(), // 3j
    sourceId: "src-b", // 0.5
    sourceType: "rss",
  };
  const rl = scoreArticle(lim, reliableSourceCache);
  console.log(`    [info] Article limite score = ${rl.score}`);
  expect(`Article limite score between 40-80 (got ${rl.score})`, rl.score >= 40 && rl.score <= 80);

  // Article below threshold (textContent vide → rejet binaire depuis F04).
  const empty: ScorableArticle = {
    url: "https://example.com/empty",
    title: "",
    textContent: "",
    publishedAt: null,
    sourceId: "src-b",
    sourceType: "rss",
  };
  const re = scoreArticle(empty, reliableSourceCache);
  expect(`Article vide rejected=true (F04)`, re.rejected === true);
  expect(`Article vide rejectionReason=empty_content`,
    re.rejectionReason === "empty_content");
  expect(`Article vide score=0 (got ${re.score})`, re.score === 0);
  expect(`Article vide keywordDensity=0 (got ${re.components.keywordDensity})`,
    re.components.keywordDensity === 0);
  expect(`Article vide antiPromo=1 (got ${re.components.antiPromo})`,
    re.components.antiPromo === 1);
  expect(`Article vide recency=0.5 (got ${re.components.recency})`,
    re.components.recency === 0.5);

  // Source absente du cache → 0.5.
  const miss: ScorableArticle = {
    url: "https://example.com/miss",
    title: "Test",
    textContent: "SIRH paie formation",
    publishedAt: new Date().toISOString(),
    sourceId: "src-missing", // absent du cache
    sourceType: "rss",
  };
  const rm = scoreArticle(miss, reliableSourceCache);
  expect(`Source absente sourceReliability=0.5 (got ${rm.components.sourceReliability})`,
    rm.components.sourceReliability === 0.5);

  // publishedAt futur (drift) → recency = 0.
  const future: ScorableArticle = {
    url: "https://example.com/future",
    title: "Test",
    textContent: "SIRH paie",
    publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1h
    sourceId: "src-b",
    sourceType: "rss",
  };
  const rf = scoreArticle(future, reliableSourceCache);
  expect(`publishedAt futur recency=0 (got ${rf.components.recency})`, rf.components.recency === 0);

  // Source reliability 0 → composante 0.
  const blacklist: ScorableArticle = {
    url: "https://example.com/blacklist",
    title: "SIRH",
    textContent: "paie",
    publishedAt: new Date().toISOString(),
    sourceId: "src-c", // 0 → 0.0
    sourceType: "rss",
  };
  const rb = scoreArticle(blacklist, reliableSourceCache);
  expect(`Source reliability 0 → composante 0 (got ${rb.components.sourceReliability})`,
    rb.components.sourceReliability === 0);
}

// ============================================================================
// Tests sourceReliabilityCache.ts
// ============================================================================
console.log("\n--- sourceReliabilityCache.ts ---");
{
  const cache = new Map<string, number>([["x", 70]]);
  expect("getReliability(x) = 0.7", getReliability("x", cache) === 0.7);
  expect("getReliability(missing) = 0.5", getReliability("missing", cache) === 0.5);
  const empty = new Map<string, number>();
  expect("getReliability(x, empty) = 0.5", getReliability("x", empty) === 0.5);
}

// ============================================================================
// Performance
// ============================================================================
console.log("\n--- Perf ---");
{
  const articles: ScorableArticle[] = Array.from({ length: 50 }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `L'IA et le SIRH article ${i} : ${"SIRH paie QVT RPS formation recrutement ".repeat(3)}`,
    textContent: "L'intelligence artificielle et le SIRH transforment la paie, le recrutement, la formation, l'évaluation des talents. Le machine learning et le LLM automatisent. RGPD CNIL IA Act. " + "contenu ".repeat(100),
    publishedAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
    sourceId: i % 2 === 0 ? "src-a" : "src-b",
    sourceType: "rss" as const,
  }));
  const t0 = Date.now();
  const results = articles.map((a) => scoreArticle(a, reliableSourceCache));
  const dt = Date.now() - t0;
  expect(`50 articles scoren en < 1000ms (got ${dt}ms)`, dt < 1000);
  expect(`50 articles tous retournent un score >= 0`, results.every((r) => r.score >= 0));
}

// ============================================================================
// loadReliabilityMap (mode dégradé)
// ============================================================================
console.log("\n--- loadReliabilityMap (mode dégradé) ---");
{
  // F15 : portable entre env AI Studio (Firestore indispo) et dev local
  // (credentials configurées). On accepte les deux : Map vide OU Map peuplée
  // de scores dans [0, 100].
  let m: Map<string, number>;
  try {
    m = await loadReliabilityMap();
  } catch {
    m = new Map<string, number>();
  }
  const isDegraded = m.size === 0;
  const isPopulated = Array.from(m.values()).every(
    (v) => Number.isFinite(v) && v >= 0 && v <= 100,
  );
  expect(`loadReliabilityMap retourne Map vide OU Map peuplée de scores valides (got size=${m.size})`,
    isDegraded || isPopulated);
}

console.log(`\n=========================================`);
console.log(`  ${pass} passés / ${fail} échoués`);
console.log(`=========================================\n`);

if (fail > 0) process.exit(1);
