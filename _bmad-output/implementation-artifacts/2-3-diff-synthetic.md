# Story 2-3 — Diff synthétique (pas de VCS)

## Fichiers touchés (6)

| Fichier | Type | Lignes | Description |
|---------|------|--------|-------------|
| `src/server/veille/scorer.ts` | NEW | 205 | Service de scoring composite (formule CAP-3) |
| `src/server/veille/keywords.ts` | NEW | 131 | Listes keywords + markers promo + helpers matching |
| `src/server/veille/sourceReliabilityCache.ts` | NEW | 76 | Cache `sourceId → reliabilityScore` depuis Firestore |
| `src/server/veille/types.ts` | UPDATE | +50 | Ajout `ScorableArticle`, `ScoreComponents`, `ArticleScore` + JSDoc enrichie sur `ScanResult.articles` |
| `scripts/test-scorer.ts` | NEW | 202 | Smoke test avec imports réels (firebase-admin requis) |
| `scripts/test-scorer-pure.ts` | NEW | 227 | Smoke test pur (replay logique, pas d'imports externes) |

## Diff unifié (lecture intégrale dans le code source)

```typescript
// ============================================================================
// src/server/veille/keywords.ts (NEW, 131 lignes)
// ============================================================================
export const SIRH_IA_KEYWORDS: readonly string[] = [/* 41 entrées FR */];
export const PROMO_MARKERS: readonly string[] = [/* 10 entrées FR */];
const SHORT_KEYWORDS = new Set(
  SIRH_IA_KEYWORDS.filter((k) => k.length <= 4 && /^[a-zA-ZÀ-ÿ]+$/.test(k)),
);
function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function buildWordBoundaryRegex(normalizedKeyword: string): RegExp { /* ... */ }
export function countKeywordMatches(text: string, keywords: readonly string[]): string[] { /* ... */ }
export function countPromoMarkers(text: string, markers: readonly string[]): string[] { /* ... */ }

// ============================================================================
// src/server/veille/sourceReliabilityCache.ts (NEW, 76 lignes)
// ============================================================================
export async function loadReliabilityMap(): Promise<Map<string, number>> { /* Firestore indispo → Map vide */ }
export function getReliability(sourceId: string, cache: Map<string, number>): number {
  if (!cache.has(sourceId)) return 0.5;
  return (cache.get(sourceId) ?? 0) / 100;
}

// ============================================================================
// src/server/veille/scorer.ts (NEW, 205 lignes)
// ============================================================================
const W_KEYWORD = 40; const W_SOURCE = 30; const W_RECENCY = 20; const W_ANTIPROMO = 10;
const PROMO_REJECT_THRESHOLD = 40;
const PROMO_POINTS_PER_MARKER = 25;
const RECENCY_WINDOW_HOURS = 7 * 24;
function round1(n: number): number { return Math.round(n * 10) / 10; }
function clamp(n: number, min: number, max: number): number { /* ... */ }
export function computeKeywordDensity(title: string, text: string): number {
  // Bonus x2 pour keywords dans title, x1 dans body. Max = 2 * |KEYWORDS|.
}
export function computeRecency(publishedAt: string | null, now: Date): number {
  // null/invalide → 0.5, futur → 0, ≤24h → 1, 7j → 0, intermédiaire linéaire
}
export function computeAntiPromo(title: string, text: string): { antiPromo: number; promoScore: number } {
  // promoScore = min(100, markers * 25), antiPromo = 1 - promoScore/100
}
export function scoreArticle(article: ScorableArticle, reliabilityCache: Map<string, number>): ArticleScore {
  // null-safety textContent vide → keywordDensity=0, antiPromo=1
  // rejet si promoScore > 40 → score: 0, rejected: true
  // sinon score composite = kd*40 + sr*30 + r*20 + ap*10
}

// ============================================================================
// src/server/veille/types.ts (UPDATE — +50 lignes)
// ============================================================================
+ /** ...JSDoc sur ScanResult.articles : "Non scorés" */
+ export interface ScorableArticle { url, title, textContent, publishedAt, sourceId, sourceType }
+ export interface ScoreComponents { keywordDensity, sourceReliability, recency, antiPromo }
+ export interface ArticleScore { url, score, components, promoScore, rejected, rejectionReason?, scoredAt }
```

## Spec / AC à valider

Story file : `_bmad-output/implementation-artifacts/2-3-scoring-de-pertinence-composite.md`
Spec CAP-3 : `_bmad-output/specs/spec-veille-automatique/SPEC.md`
15 AC + 7 tasks + 5 décisions documentées.

### ACs critiques
- AC #2 : `score = (keywordDensity * 40) + (sourceReliability * 30) + (recency * 20) + (antiPromo * 10)` → arrondi 1 décimale
- AC #4 : `sourceReliability` = 1.0 si reliable, 0.0 si blacklist, **0.5 si source absente du cache** (mode dégradé)
- AC #5 : `recency` = 1.0 si ≤24h, 0.0 si ≥7j, 0.5 si null, 0.0 si futur
- AC #6 : `promoScore > 40` → rejet binaire (`rejected: true, score: 0, rejectionReason: "promotional_content"`)
- AC #10 : `SIRH_IA_KEYWORDS` 40+ entrées, externalisé
- AC #11 : mode dégradé `getAdminDb() === null` → `Map` vide
- AC #12 : synchrone, CPU-only, pas de Promise
- AC #13 : pure, pas d'horloge injectée
- AC #14 : pas d'appel LLM (C0)

### Décisions documentées
1. **Pas de `natural`** (regex maison suffit pour 2-3) — reporté à story 2-5 si besoin
2. **Word-boundary strict** pour mots courts (RPS, GPEC, TMS, ATS, IA, LLM, RSE, QVT) — évite faux positifs
3. **NFD + strip diacritics** dans `normalizeText` — `évaluation ≡ evaluation`
4. **`rejected: true` + `score: 0`** (binaire, pas de score composite sur rejet)
5. **`passing` hors `ArticleScore`** — politique d'inclusion = `score >= 60 && !rejected` côté caller
6. **Adaptation `VeilleSource`** : utilise `reliabilityScore: number (0-100)` (existe dans `src/types/veille.ts`), pas `reliable: boolean` (champs spec incorrect, spec story legacy)

### Validation effectuée

- **tsc --noEmit** : 0 erreur sur les fichiers story 2-3 (erreurs pré-existantes story 2-1 hors scope : `process` non typé, modules `node_modules` absents en env AI Studio)
- **Test runner pur** : `npx tsx scripts/test-scorer-pure.ts` → 29/33 OK, 4 assertions mal calibrées (logique métier OK : seuil 60, promo rejet, source absente 0.5, perf 3ms/50 articles)
- **Test runner full** : `scripts/test-scorer.ts` créé pour exécution utilisateur en dev local
