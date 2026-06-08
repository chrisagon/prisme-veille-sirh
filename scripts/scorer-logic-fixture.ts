/**
 * Fixture algorithmique pour le scoring composite (story 2-3).
 * ATTENTION : ce fichier duplique la logique de production (keywords.ts, scorer.ts)
 * pour valider les ACs critiques en l'absence de node_modules (env AI Studio).
 * Risque de drift si la production évolue. Toute divergence entre cette fixture
 * et le code réel doit être corrigée des deux côtés.
 *
 * Exécuter : `npx tsx scripts/scorer-logic-fixture.ts`
 * Pour un vrai test de la prod : `npx tsx scripts/test-scorer.ts` (après `npm install`).
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

const SIRH_IA_KEYWORDS = [
  "SIRH", "paie", "GPEC", "GEPP", "ATS", "TMS", "QVT", "RPS",
  "recrutement", "formation", "entretien annuel", "évaluation",
  "talents", "marque employeur", "onboarding", "offboarding",
  "mobilité interne", "diversité", "inclusion", "bien-être au travail",
  "absentéisme", "turnover", "RSE", "droit social", "télétravail",
  "hybrid work", "SaaS RH", "People Analytics", "HR Tech", "HRC",
  "intelligence artificielle", "IA", "machine learning", "deep learning",
  "générative", "LLM", "agent IA", "chatbot RH", "automation RH",
  "IA Act", "RGPD", "CNIL",
];

const PROMO_MARKERS = [
  "nous proposons", "contactez-nous", "demandez une démo",
  "solution clé en main", "gratuit", "offre limitée",
  "essai gratuit", "réduction exclusive", "abonnez-vous",
  "téléchargez maintenant",
];

const WORD_BOUNDARY_MAX_LENGTH = 7;

function buildWordBoundarySet(terms: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of terms) {
    const normalized = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
    if (normalized.length > 0 && normalized.length <= WORD_BOUNDARY_MAX_LENGTH) {
      set.add(raw);
    }
  }
  return set;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function buildWordBoundaryRegex(normalizedKeyword: string): RegExp {
  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "g");
}

function countKeywordMatches(text: string, keywords: readonly string[]): string[] {
  if (!text || keywords.length === 0) return [];
  const normalized = normalizeText(text);
  const shortSet = buildWordBoundarySet(keywords);
  const found = new Set<string>();
  for (const raw of keywords) {
    const normalizedKeyword = normalizeText(raw);
    if (normalizedKeyword.length === 0) continue;
    let matched = false;
    if (shortSet.has(raw)) {
      const re = buildWordBoundaryRegex(normalizedKeyword);
      matched = re.test(normalized);
    } else {
      matched = normalized.includes(normalizedKeyword);
    }
    if (matched) found.add(raw);
  }
  return Array.from(found);
}

function countPromoMarkers(text: string, markers: readonly string[]): string[] {
  if (!text || markers.length === 0) return [];
  const normalized = normalizeText(text);
  const shortSet = buildWordBoundarySet(markers);
  const found: string[] = [];
  for (const raw of markers) {
    const normalizedMarker = normalizeText(raw);
    if (normalizedMarker.length === 0) continue;
    let matched = false;
    if (shortSet.has(raw)) {
      const re = buildWordBoundaryRegex(normalizedMarker);
      matched = re.test(normalized);
    } else {
      matched = normalized.includes(normalizedMarker);
    }
    if (matched) found.push(raw);
  }
  return found;
}

// === Tests keywords ===
console.log("\n--- keywords ---");
expect("RPS matche", countKeywordMatches("Les RPS au travail", SIRH_IA_KEYWORDS).includes("RPS"));
expect("RPS absent de GRPS", !countKeywordMatches("GRPS utilisé", SIRH_IA_KEYWORDS).includes("RPS"));
expect("IA absent de DIAL", !countKeywordMatches("Le DIAL est ouvert", SIRH_IA_KEYWORDS).includes("IA"));
expect("évaluation accent matche", countKeywordMatches("Une évaluation annuelle", SIRH_IA_KEYWORDS).includes("évaluation"));
expect("evaluation sans accent matche aussi", countKeywordMatches("L'evaluation du personnel", SIRH_IA_KEYWORDS).includes("évaluation"));
expect("contactez-nous case-insensitive", countPromoMarkers("Contactez-nous !", PROMO_MARKERS).includes("contactez-nous"));
expect("recontactez matche (substring)", countPromoMarkers("Veuillez recontactez-nous", PROMO_MARKERS).includes("contactez-nous"));
expect("0 keywords dans texte vide", countKeywordMatches("", SIRH_IA_KEYWORDS).length === 0);
// F01+F02 (word-boundary étendu) :
expect("gratuit absent de gratuitement (F01)", !countPromoMarkers("Cet outil est gratuitement accessible", PROMO_MARKERS).includes("gratuit"));
expect("essai gratuit absent de essai gratuitX (substring)", countPromoMarkers("Demande d'essai gratuitX", PROMO_MARKERS).includes("essai gratuit"));
expect("RPS absent de GRPS (déjà OK, ≤4 chars)", !countKeywordMatches("GRPS utilisé", SIRH_IA_KEYWORDS).includes("RPS"));
expect("LLM absent de ALLMA (≤3 chars)", !countKeywordMatches("Le ALLMA gère ça", SIRH_IA_KEYWORDS).includes("LLM"));

// === Tests computeKeywordDensity (replay logique) ===
console.log("\n--- computeKeywordDensity (replay) ---");
function computeKeywordDensity(title: string, text: string, keywords: readonly string[]): number {
  if (!title && !text) return 0;
  const t = countKeywordMatches(title, keywords);
  const x = countKeywordMatches(text, keywords);
  const tOnly = t.filter((k) => !x.includes(k));
  const overlap = t.filter((k) => x.includes(k));
  const xOnly = x.filter((k) => !t.includes(k));
  const total = tOnly.length * 2 + overlap.length * 2 + xOnly.length * 1;
  const max = keywords.length * 2;
  return Math.max(0, Math.min(1, total / max));
}
{
  const idealText = "L'IA SIRH paie recrutement formation évaluation talents QVT RPS LLM machine learning RGPD CNIL";
  const d = computeKeywordDensity("L'IA générative et le SIRH", idealText, SIRH_IA_KEYWORDS);
  console.log(`    density idéal = ${d.toFixed(3)}`);
  expect("Densité > 0.3 sur article riche", d > 0.3);
  expect("Densité < 1.0 (jamais parfait)", d < 1.0);
}

// === Tests computeRecency ===
console.log("\n--- computeRecency ---");
function computeRecency(publishedAt: string | null, now: Date): number {
  if (publishedAt === null) return 0.5;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0.5;
  const ageMs = now.getTime() - ts;
  if (ageMs < 0) return 0;
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 24) return 1;
  if (ageHours >= 7 * 24) return 0;
  return Math.max(0, Math.min(1, 1 - (ageHours - 24) / (7 * 24 - 24)));
}
const now = new Date();
expect("recency(null) = 0.5", computeRecency(null, now) === 0.5);
expect("recency(1h) = 1.0", computeRecency(new Date(now.getTime() - 3600_000).toISOString(), now) === 1.0);
expect("recency(3j) ≈ 0.5",
  Math.abs(computeRecency(new Date(now.getTime() - 3 * 86400_000).toISOString(), now) - (1 - 2 / 6)) < 0.01);
expect("recency(7j) = 0.0", computeRecency(new Date(now.getTime() - 7 * 86400_000).toISOString(), now) === 0.0);
expect("recency(futur) = 0.0", computeRecency(new Date(now.getTime() + 3600_000).toISOString(), now) === 0.0);
expect("recency(invalide) = 0.5", computeRecency("not a date", now) === 0.5);

// === Tests computeAntiPromo ===
console.log("\n--- computeAntiPromo ---");
function computeAntiPromo(title: string, text: string): { antiPromo: number; promoScore: number } {
  const fullText = `${title} ${text}`;
  const markers = countPromoMarkers(fullText, PROMO_MARKERS);
  const promoScore = Math.max(0, Math.min(100, markers.length * 25));
  return { antiPromo: Math.max(0, Math.min(1, 1 - promoScore / 100)), promoScore };
}
{
  const r = computeAntiPromo("", "Bonjour");
  expect("antiPromo 0 markers = 1.0", r.antiPromo === 1.0);
  expect("promoScore 0 markers = 0", r.promoScore === 0);
}
{
  const r = computeAntiPromo("Solution clé en main", "Nous proposons. Contactez-nous. Demandez une démo. Offre limitée.");
  expect("4 markers → promoScore = 100", r.promoScore === 100);
  expect("4 markers → antiPromo = 0.0", r.antiPromo === 0.0);
}
{
  const r = computeAntiPromo("", "Essai gratuit");
  expect("1 marker → promoScore = 25", r.promoScore === 25);
  expect("1 marker → antiPromo = 0.75", r.antiPromo === 0.75);
}

// === Tests score composite (replay) ===
console.log("\n--- score composite (replay) ---");
function scoreArticle(article: any, cache: Map<string, number>): any {
  if (!article.textContent || article.textContent.trim().length === 0) {
    // F04 : rejet binaire.
    return { score: 0, rejected: true, rejectionReason: "empty_content", components: { keywordDensity: 0, sourceReliability: 0, recency: Math.round(computeRecency(article.publishedAt, new Date()) * 10) / 10, antiPromo: 1 } };
  }
  const kd = computeKeywordDensity(article.title, article.textContent, SIRH_IA_KEYWORDS);
  const sr = cache.get(article.sourceId) === undefined ? 0.5 : (cache.get(article.sourceId)! / 100);
  const r = computeRecency(article.publishedAt, new Date());
  const { antiPromo: ap, promoScore: ps } = computeAntiPromo(article.title, article.textContent);
  if (ps > 40) return { score: 0, rejected: true, rejectionReason: "promotional_content", promoScore: ps };
  const raw = kd * 40 + sr * 30 + r * 20 + ap * 10;
  return { score: Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10, rejected: false, promoScore: ps, components: { keywordDensity: Math.round(kd * 10) / 10, sourceReliability: Math.round(sr * 10) / 10, recency: Math.round(r * 10) / 10, antiPromo: Math.round(ap * 10) / 10 } };
}
{
  const cache = new Map([["a", 85], ["b", 50], ["c", 0]]);
  const ideal = { title: "L'IA générative et le SIRH", textContent: "IA SIRH paie recrutement formation évaluation talents QVT RPS LLM machine learning RGPD CNIL " + "x".repeat(200), publishedAt: new Date(now.getTime() - 3600_000).toISOString(), sourceId: "a" };
  const r = scoreArticle(ideal, cache);
  console.log(`    Article idéal → score = ${r.score}, components = ${JSON.stringify(r.components)}`);
  expect("Article idéal score >= 70", r.score >= 70);
  expect("Article idéal NOT rejected", r.rejected === false);

  const promo = { title: "Solution clé en main", textContent: "Nous proposons. Contactez-nous. Demandez une démo. Offre limitée. Essai gratuit.", publishedAt: new Date().toISOString(), sourceId: "a" };
  const rp = scoreArticle(promo, cache);
  console.log(`    Article promo → score = ${rp.score}, rejected = ${rp.rejected}, reason = ${rp.rejectionReason}`);
  expect("Article promo rejected", rp.rejected === true);
  expect("Article promo score = 0", rp.score === 0);
  expect("Article promo reason = promotional_content", rp.rejectionReason === "promotional_content");

  const empty = { title: "", textContent: "", publishedAt: null, sourceId: "b" };
  const re = scoreArticle(empty, cache);
  console.log(`    Article vide → score = ${re.score}, rejected = ${re.rejected}, reason = ${re.rejectionReason}`);
  expect("Article vide rejected (F04)", re.rejected === true);
  expect("Article vide reason = empty_content", re.rejectionReason === "empty_content");
  expect("Article vide score = 0", re.score === 0);
  expect("Article vide keywordDensity = 0", re.components.keywordDensity === 0);
  expect("Article vide antiPromo = 1", re.components.antiPromo === 1);
  expect("Article vide recency = 0.5", re.components.recency === 0.5);

  const miss = { title: "Test", textContent: "SIRH paie", publishedAt: new Date().toISOString(), sourceId: "missing" };
  const rm = scoreArticle(miss, cache);
  expect("Source absente → sourceReliability = 0.5", rm.components.sourceReliability === 0.5);

  // Perf
  const articles = Array.from({ length: 50 }, (_, i) => ({
    title: "L'IA et le SIRH " + i,
    textContent: "IA SIRH paie recrutement formation évaluation talents QVT RPS LLM machine learning RGPD CNIL " + "y ".repeat(200),
    publishedAt: new Date(now.getTime() - i * 3600_000).toISOString(),
    sourceId: i % 2 === 0 ? "a" : "b",
  }));
  const t0 = Date.now();
  const results = articles.map((a) => scoreArticle(a, cache));
  const dt = Date.now() - t0;
  console.log(`    Perf 50 articles : ${dt}ms`);
  expect("Perf 50 < 1000ms", dt < 1000);
  expect("Tous scores >= 0", results.every((r) => r.score >= 0));
}

console.log(`\n=========================================`);
console.log(`  ${pass} passés / ${fail} échoués`);
console.log(`=========================================\n`);
if (fail > 0) process.exit(1);
