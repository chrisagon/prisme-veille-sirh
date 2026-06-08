/**
 * Service de scoring de pertinence composite (CAP-3 spec veille automatique).
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-3)
 * Cf. _bmad-output/implementation-artifacts/2-3-scoring-de-pertinence-composite.md
 *
 * Responsabilités :
 * - Calculer un score 0-100 = (keywordDensity * 40) + (sourceReliability * 30)
 *                            + (recency * 20) + (antiPromo * 10)
 * - Rejeter les articles promotionnels (promoScore > 40).
 * - Mode dégradé (Firestore indispo → cache vide) : sourceReliability = 0.5.
 * - Pas d'I/O : CPU-only, synchrone, pure (même input → même output).
 * - Pas de LLM (C0 zéro hallucination).
 *
 * Anti-hallucination (C0) : aucun appel LLM, pas de génération de texte.
 * Le score agrège des matches regex et des métadonnées déclaratives.
 */

import { ScorableArticle, ArticleScore } from "./types";
import {
  SIRH_IA_KEYWORDS,
  PROMO_MARKERS,
  countKeywordMatches,
  countPromoMarkers,
} from "./keywords";
import { getReliability } from "./sourceReliabilityCache";

/** Poids des composantes (cf. AC #2). Somme = 100. */
const W_KEYWORD = 40;
const W_SOURCE = 30;
const W_RECENCY = 20;
const W_ANTIPROMO = 10;

/** Seuil de promo au-delà duquel l'article est rejeté binaire. */
const PROMO_REJECT_THRESHOLD = 40;

/** Points de promo par marker trouvé (capé à 100 par `Math.min`). */
const PROMO_POINTS_PER_MARKER = 25;

/** Fenêtre de fraîcheur (7 jours en heures). Au-delà → recency = 0. */
const RECENCY_WINDOW_HOURS = 7 * 24;

/**
 * Arrondi à 1 décimale. EPSILON ajouté pour neutraliser le floating-point sur
 * les frontières .5 (ex: `round1(0.85) = 0.9` au lieu de 0.85, conforme ES spec
 * "round half away from zero").
 */
function round1(n: number): number {
  return Math.round(n * 10 + Number.EPSILON) / 10;
}

/** Clamp [min, max] sans NaN. */
function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Calcule la densité de mots-clés (0-1).
 *
 * - Si 0 match : 0.0.
 * - Si tous les keywords matchent : 1.0.
 * - Bonus x2 pour les keywords présents dans le `title` (au lieu de x1 si
 *   uniquement dans le body). Reflète la pertinence éditoriale (un article
 *   qui titre "IA et SIRH" est plus pertinent qu'un qui le mentionne en passant).
 */
export function computeKeywordDensity(title: string, text: string): number {
  if (!title && !text) return 0;
  const titleMatches = countKeywordMatches(title, SIRH_IA_KEYWORDS);
  const textMatches = countKeywordMatches(text, SIRH_IA_KEYWORDS);
  // Union : un keyword qui matche à la fois dans title ET text compte 1 fois
  // (Set), mais on applique le bonus x2 à la détection title-only.
  const titleOnly = titleMatches.filter((k) => !textMatches.includes(k));
  const overlap = titleMatches.filter((k) => textMatches.includes(k));
  const textOnly = textMatches.filter((k) => !titleMatches.includes(k));

  // Pondération : title-only = 2 points, overlap = 2 points (title + body),
  // text-only = 1 point. Max = 2 * |SIRH_IA_KEYWORDS|.
  const total = titleOnly.length * 2 + overlap.length * 2 + textOnly.length * 1;
  const max = SIRH_IA_KEYWORDS.length * 2;
  return clamp(total / max, 0, 1);
}

/**
 * Calcule la fraîcheur temporelle (0-1).
 *
 * - âge ≤ 24h → 1.0
 * - âge = 7j → 0.0
 * - intermédiaire : `1 - (ageHours / (7 * 24))`
 * - publishedAt > now (drift futur) : 0.0 (considéré KO).
 * - publishedAt null : 0.5 (neutre).
 */
export function computeRecency(publishedAt: string | null, now: Date): number {
  if (publishedAt === null) return 0.5;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0.5;
  const ageMs = now.getTime() - ts;
  if (ageMs < 0) return 0; // futur → pénalité
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 24) return 1;
  if (ageHours >= RECENCY_WINDOW_HOURS) return 0;
  return clamp(1 - (ageHours - 24) / (RECENCY_WINDOW_HOURS - 24), 0, 1);
}

/**
 * Calcule la composante anti-promotionnelle (0-1) ET le score promo (0-100).
 *
 * - 0 marker → antiPromo = 1.0, promoScore = 0.
 * - N markers → promoScore = min(100, N * 25), antiPromo = 1 - (promoScore / 100).
 */
export function computeAntiPromo(title: string, text: string): {
  antiPromo: number;
  promoScore: number;
} {
  const fullText = `${title} ${text}`;
  const markers = countPromoMarkers(fullText, PROMO_MARKERS);
  const promoScore = clamp(markers.length * PROMO_POINTS_PER_MARKER, 0, 100);
  const antiPromo = clamp(1 - promoScore / 100, 0, 1);
  return { antiPromo, promoScore };
}

/**
 * Scorer un article. Pure, synchrone, CPU-only.
 *
 * - `reliabilityCache` est le mapping `sourceId → reliabilityScore (0-100)` chargé
 *   en amont par le caller (typiquement via `loadReliabilityMap()`). Si une source
 *   n'est pas dans le cache (Firestore indispo ou source récente), `getReliability`
 *   retourne `0.5` (neutre).
 * - `now` est injectable pour testabilité/détermisme intra-batch. Défaut = `new Date()`.
 * - Retourne un `ArticleScore` avec score arrondi à 1 décimale.
 * - Si `textContent` est vide (whitespace-only inclus) → rejet binaire
 *   `score: 0, rejected: true, rejectionReason: "empty_content"`. Évite qu'un
 *   article non-informatif passe le seuil d'inclusion (60) par le seul bonus
 *   sourceReliability + recency.
 * - Si l'article est rejeté pour promotion (`promoScore > 40`), retourne
 *   `score: 0, rejected: true, rejectionReason: "promotional_content"`.
 *   Le score composite n'est PAS calculé (rejet binaire).
 *
 * @throws Ne throw JAMAIS. Toute donnée manquante est traitée par défaut.
 */
export function scoreArticle(
  article: ScorableArticle,
  reliabilityCache: Map<string, number>,
  now: Date = new Date(),
): ArticleScore {
  // Null-safety (AC #11) + F04 : textContent vide → rejet binaire.
  if (!article.textContent || article.textContent.trim().length === 0) {
    return {
      url: article.url,
      score: 0,
      components: {
        keywordDensity: 0,
        sourceReliability: round1(getReliability(article.sourceId, reliabilityCache)),
        recency: round1(computeRecency(article.publishedAt, now)),
        antiPromo: 1,
      },
      promoScore: 0,
      rejected: true,
      rejectionReason: "empty_content",
      scoredAt: now.toISOString(),
    };
  }

  // Calcul des 4 composantes.
  const keywordDensity = computeKeywordDensity(article.title, article.textContent);
  const sourceReliability = getReliability(article.sourceId, reliabilityCache);
  const recency = computeRecency(article.publishedAt, now);
  const { antiPromo, promoScore } = computeAntiPromo(article.title, article.textContent);

  // Rejet promotionnel (binaire).
  if (promoScore > PROMO_REJECT_THRESHOLD) {
    return {
      url: article.url,
      score: 0,
      components: {
        keywordDensity: round1(keywordDensity),
        sourceReliability: round1(sourceReliability),
        recency: round1(recency),
        antiPromo: round1(antiPromo),
      },
      promoScore: round1(promoScore),
      rejected: true,
      rejectionReason: "promotional_content",
      scoredAt: now.toISOString(),
    };
  }

  // Score composite pondéré.
  const raw =
    keywordDensity * W_KEYWORD +
    sourceReliability * W_SOURCE +
    recency * W_RECENCY +
    antiPromo * W_ANTIPROMO;
  const score = clamp(raw, 0, 100);

  return {
    url: article.url,
    score: round1(score),
    components: {
      keywordDensity: round1(keywordDensity),
      sourceReliability: round1(sourceReliability),
      recency: round1(recency),
      antiPromo: round1(antiPromo),
    },
    promoScore: round1(promoScore),
    rejected: false,
    scoredAt: now.toISOString(),
  };
}
