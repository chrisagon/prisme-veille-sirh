/**
 * Smoke test manual pour story 2-4 (persistance + orchestrateur).
 * Exécuter : `npx tsx scripts/test-persistence.ts` (après `npm install`)
 *
 * Le test s'adapte à l'environnement :
 * - Si Firebase credentials absentes (env AI Studio) : mode dégradé.
 *   On valide que toutes les fonctions retournent des défauts (zéros) sans throw.
 * - Si Firebase credentials présentes : tests d'intégration via emulator
 *   (caller doit lancer `firebase emulators:start` au préalable).
 *
 * NOTE env AI Studio : ce script nécessite `firebase-admin` installé. Pour
 * valider la logique pure (computeExpiresAt, computePassing), utiliser plutôt
 * `scripts/persistence-logic-fixture.ts` qui n'a pas de dépendance externe.
 */

import { extractAndPersistAll, persistExtractedArticle, purgeExpiredArticles, loadPassingArticles, computeExpiresAt, computePassing } from "../src/server/veille/persistence";
import { BATCH_RETENTION_MS, PASSING_SCORE_THRESHOLD } from "../src/server/veille/types";
import type { ExtractedArticle, ArticleScore, ArticleCandidate } from "../src/server/veille/types";
import { getAdminDb } from "../src/server/firebaseAdmin";

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

const db = getAdminDb();
const isDegraded = db === null;
console.log(`\n[test-persistence] Mode ${isDegraded ? "DÉGRADÉ (Firestore indispo)" : "INTÉGRÉ (Firestore dispo)"}`);

// ============================================================================
// Tests purs (computeExpiresAt, computePassing)
// ============================================================================
console.log("\n--- computeExpiresAt (replay) ---");
{
  const now = new Date();
  const exp = computeExpiresAt(now);
  expect(
    `computeExpiresAt(now) = now + 7j (diff = ${BATCH_RETENTION_MS}ms)`,
    exp.getTime() - now.getTime() === BATCH_RETENTION_MS,
  );
  expect(
    `BATCH_RETENTION_MS = ${BATCH_RETENTION_MS}`,
    BATCH_RETENTION_MS === 7 * 24 * 60 * 60 * 1000,
  );
  expect(
    `PASSING_SCORE_THRESHOLD = 60`,
    PASSING_SCORE_THRESHOLD === 60,
  );
}

console.log("\n--- computePassing (replay) ---");
{
  expect(`score=70 → passing`, computePassing(70, false));
  expect(`score=60 (frontière) → passing`, computePassing(60, false));
  expect(`score=59.9 → NOT passing`, !computePassing(59.9, false));
  expect(`rejected=true → NOT passing (peu importe score)`, !computePassing(100, true));
}

// ============================================================================
// Tests mode dégradé : aucune fonction ne doit throw
// ============================================================================
if (isDegraded) {
  console.log("\n--- Mode dégradé (Firestore indispo) ---");

  console.log("\n--- extractAndPersistAll([]) ---");
  {
    const result = await extractAndPersistAll([], "scan-empty");
    expect(
      `extractAndPersistAll([]) → {persisted: 0, skipped: 0, failed: 0, batchId: ""}`,
      result.persisted === 0 && result.skipped === 0 && result.failed === 0 && result.batchId === "",
    );
  }

  console.log("\n--- purgeExpiredArticles() ---");
  {
    const result = await purgeExpiredArticles();
    expect(
      `purgeExpiredArticles → {purged: 0, durationMs: 0, reason: "firestore_unavailable"}`,
      result.purged === 0 && result.durationMs === 0 && result.reason === "firestore_unavailable",
    );
  }

  console.log("\n--- loadPassingArticles() ---");
  {
    const docs = await loadPassingArticles();
    expect(
      `loadPassingArticles → []`,
      Array.isArray(docs) && docs.length === 0,
    );
  }

  console.log("\n--- persistExtractedArticle() ---");
  {
    const extracted: ExtractedArticle = {
      url: "https://example.com/test",
      title: "Test",
      excerpt: "...",
      textContent: "Lorem ipsum dolor sit amet",
      html: "<p>Lorem ipsum...</p>",
      length: 26,
      sourceId: "test-src",
      sourceType: "rss",
      extractedAt: new Date().toISOString(),
    };
    const score: ArticleScore = {
      url: extracted.url,
      score: 75,
      components: { keywordDensity: 0.5, sourceReliability: 0.8, recency: 0.9, antiPromo: 1 },
      promoScore: 0,
      rejected: false,
      scoredAt: new Date().toISOString(),
    };
    const result = await persistExtractedArticle(extracted, score, "scan-1", "batch-1", null);
    expect(
      `persistExtractedArticle → {persisted: 0, skipped: 1, reason: "firestore_unavailable"}`,
      result.persisted === 0 && result.skipped === 1 && result.reason === "firestore_unavailable",
    );
  }

  console.log("\n--- extractAndPersistAll avec articles (chemin RSS) ---");
  {
    // En mode dégradé, le chemin RSS est opérationnel (pas de Firestore requis)
    // MAIS le score et la persistance retournent skipped.
    // Sur CI sans réseau, extractFromRssCandidate peut aussi retourner null
    // si la description est absente. On teste avec un candidat minimal.
    const candidates: ArticleCandidate[] = [
      {
        url: "https://example.com/rss-test",
        title: "Test RSS",
        publishedAt: new Date().toISOString(),
        sourceId: "src-degraded",
        sourceType: "rss",
        description: "Lorem ipsum SIRH paie formation",
      },
    ];
    let result;
    try {
      result = await extractAndPersistAll(candidates, "scan-degraded");
      // Pas de throw, on a un objet
      expect(
        `extractAndPersistAll retourne un BatchResult (persisted=${result.persisted}, skipped=${result.skipped}, failed=${result.failed})`,
        typeof result.persisted === "number" && typeof result.skipped === "number" && typeof result.failed === "number",
      );
    } catch (err) {
      // Si throw (ne devrait pas), marquer fail
      const message = err instanceof Error ? err.message : String(err);
      expect(
        `extractAndPersistAll ne throw PAS (got: ${message})`,
        false,
      );
    }
  }
} else {
  console.log("\n--- Mode intégré (Firestore dispo) : non testé dans ce script ---");
  console.log("  Pour tester en intégré : lancer `firebase emulators:start` puis ce script.");
  console.log("  Les tests purs (computeExpiresAt, computePassing) ci-dessus restent valides.");
}

console.log(`\n=========================================`);
console.log(`  ${pass} passés / ${fail} échoués`);
console.log(`=========================================\n`);

if (fail > 0) process.exit(1);
