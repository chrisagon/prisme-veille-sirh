/**
 * Types internes du worker de scan périodique.
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2)
 * Cf. _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md
 *
 * Les types partagés côté client/serveur restent dans `src/types/veille.ts`.
 * Ce fichier ne contient QUE les types spécifiques au pipeline serveur.
 */

import type { Timestamp } from "firebase-admin/firestore";

/** Candidat article issu d'un parseur (RSS / sitemap / API). */
export interface ArticleCandidate {
  /** URL canonique de l'article (déjà dédupliquée par worker). */
  url: string;
  /** Titre de l'article (peut être vide si la source ne fournit pas). */
  title: string;
  /** Date de publication ISO 8601 (peut être invalide → filtrée). */
  publishedAt: string | null;
  /** ID de la source dont provient l'article (pour audit). */
  sourceId: string;
  /** Type de la source (rss / sitemap / api). */
  sourceType: "rss" | "sitemap" | "api";
  /**
   * Description / extrait brut (RSS `<description>` / `<content:encoded>`).
   * Utilisé par le pipeline de scoring (story 2-3) sans re-fetch.
   * Vide pour sitemap et API JSON sans champ équivalent.
   */
  description?: string;
}

/**
 * Article dont le contenu textuel principal a été extrait.
 * Produit par `extractor.ts` (story 2-2) à partir d'une `ArticleCandidate`
 * ou d'une URL nue.
 */
export interface ExtractedArticle {
  /** URL canonique d'entrée (déjà normalisée par `canonicalizeUrl`). */
  url: string;
  /** Titre principal (RSS title ou Readability `title`). */
  title: string;
  /** Résumé court (RSS description ou Readability `excerpt`). */
  excerpt: string;
  /** Texte intégral en clair. */
  textContent: string;
  /**
   * HTML sanitisé (Readability `content` pour chemin HTML, sanitize-html
   * pour chemin RSS). **Chaîne vide** `""` uniquement dans le cas où le
   * chemin RSS a été pris ET `extractFromRssCandidate` n'a pas pu sanitizer
   * (improbable avec sanitize-html, mais prévu par le contrat). Pour le
   * chemin HTML, ce champ contient le HTML nettoyé par Readability.
   * Consumers story 2-3+ : utiliser `textContent` pour scoring/affichage
   * plain text ; utiliser `html` uniquement si rendu HTML contrôlé.
   */
  html: string;
  /** Longueur en caractères de `textContent`. */
  length: number;
  /** Auteur (optionnel, Readability `byline` uniquement). */
  byline?: string;
  /** Nom du site (optionnel, Readability `siteName` uniquement). */
  siteName?: string;
  /** ID de la source (propagé pour le pipeline de scoring). */
  sourceId: string;
  /** Type de la source d'origine. */
  sourceType: "rss" | "sitemap" | "api";
  /** ISO 8601 du moment d'extraction. */
  extractedAt: string;
}

/** Résultat d'un scan d'une seule source. */
export interface SourceScanResult {
  sourceId: string;
  sourceName: string;
  sourceType: "rss" | "sitemap" | "api";
  /** `true` si le scan a été sauté (gating temporel, type=api sans env var, etc.). */
  skipped: boolean;
  /** Raison de skip (humainement lisible). */
  skipReason?: string;
  /** Nombre d'articles candidats trouvés (après dédoublonnage intra-scan). */
  articlesFound: number;
  /** Nombre d'erreurs rencontrées. */
  errors: number;
  /** Durée du scan de cette source en ms. */
  durationMs: number;
}

/** Résultat agrégé d'un scan complet. */
export interface ScanResult {
  /** ID unique du scan (UUID v4). */
  scanId: string;
  /** Date ISO de démarrage. */
  startedAt: string;
  /** Date ISO de fin. */
  finishedAt: string;
  /** Nombre de sources effectivement scannées. */
  sourcesScanned: number;
  /** Nombre de sources skippées (gating / config). */
  sourcesSkipped: number;
  /** Nombre total d'articles candidats trouvés. */
  articlesFound: number;
  /** Nombre d'articles dédupliqués intra-scan. */
  articlesDeduped: number;
  /** Détail par source. */
  sources: SourceScanResult[];
  /** Erreurs agrégées. */
  errors: Array<{ sourceId: string; url: string; message: string }>;
  /** Articles collectés (pour persistance par story 2-4).
   * **Non scorés** : ces candidats sont les métadonnées brutes issues des
   * parseurs (title, url, publishedAt, description). Le scoring de pertinence
   * composite (story 2-3) est appliqué par l'orchestrateur de persistance sur
   * les `ExtractedArticle` (post-extraction story 2-2), pas sur les
   * `ArticleCandidate`.
   */
  articles: ArticleCandidate[];
  /** `true` si le scan a été annulé car un autre tournait déjà. */
  skipped?: boolean;
  /** Raison de skip si skipped. */
  reason?: string;
}

/**
 * Article passé au scorer (compatible `ExtractedArticle` de story 2-2).
 * Forme minimale nécessaire au calcul de pertinence. Ajout de champs (résumé,
 * contenu enrichi) géré par story 2-5 (structuration Gemini).
 */
export interface ScorableArticle {
  url: string;
  title: string;
  textContent: string;
  publishedAt: string | null;
  sourceId: string;
  sourceType: "rss" | "sitemap" | "api";
}

/** Composantes individuelles du score de pertinence (toutes dans [0, 1]). */
export interface ScoreComponents {
  /** Densité de mots-clés SIRH/IA dans title+textContent. */
  keywordDensity: number;
  /** Fiabilité déclarée de la source (0.5 si source absente du cache). */
  sourceReliability: number;
  /** Fraîcheur temporelle (1.0 = <24h, 0.0 = >7j, 0.5 si date absente). */
  recency: number;
  /** Anti-promotionnel (1.0 = aucun marker promo, 0.0 = fortement promo). */
  antiPromo: number;
}

/**
 * Résultat du scoring d'un article (story 2-3).
 *
 * - `passing` est volontairement absent : la politique d'inclusion (seuil 60)
 *   est appliquée par le caller via `score >= 60 && !rejected`. Permet de
 *   modifier le seuil sans toucher au scorer.
 * - En cas de rejet promotionnel, `score = 0` (binaire, le score composite
 *   n'est pas significatif). Le champ `rejectionReason` indique la cause.
 */
export interface ArticleScore {
  url: string;
  /** Score final dans [0, 100], arrondi à 1 décimale. */
  score: number;
  components: ScoreComponents;
  /** Score de promotion isolé dans [0, 100]. */
  promoScore: number;
  rejected: boolean;
  /** Raison du rejet binaire. Story 2-3 a introduit `promotional_content` (promoScore > 40).
   * Story 2-4 a ajouté `empty_content` (textContent vide) suite au fix F04. Le type a
   * été aligné ici pour matcher le runtime (cf. scorer.ts). */
  rejectionReason?: "promotional_content" | "empty_content";
  /** ISO 8601 du moment du scoring. */
  scoredAt: string;
}

/**
 * Durée de rétention des articles bruts dans `veille_raw_articles` (story 2-4).
 * 7 jours exacts. Combiné au TTL natif Firestore (best-effort 24h) + un job de
 * purge custom quotidien à 03:00 UTC.
 */
export const BATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Seuil de score d'inclusion dans un rapport (politique caller, non persistée). */
export const PASSING_SCORE_THRESHOLD = 60;

/**
 * Article brut persisté dans `veille_raw_articles` (story 2-4).
 *
 * - Copie conforme de l'`ExtractedArticle` + `ArticleScore` figés pour 7 jours
 *   (cf. AC #13 : pas de re-extraction, pas de re-scoring).
 * - `id` : Firestore doc id, généré par `crypto.randomUUID()` côté Node 18+.
 * - `passing` : **non persisté**. Recalculé à la lecture par `loadPassingArticles`
 *   (seuil `PASSING_SCORE_THRESHOLD = 60 && !rejected`). Permet de modifier le
 *   seuil sans migration de données.
 * - `persistedAt` : Firestore `serverTimestamp()` (horloge serveur).
 * - `expiresAt` : `persistedAt + BATCH_RETENTION_MS`, calculé côté Node puis
 *   envoyé en `Timestamp.fromMillis()` (car `serverTimestamp()` n'est pas
 *   composable arithmétiquement côté rules).
 * - Anti-hallucination (C0) : pas de transformation du contenu, pas de
 *   résumé/re-formatage. `textContent`, `excerpt`, `title` stockés tels quels.
 */
export interface VeilleRawArticle {
  /** Firestore doc id, calculé à l'avance (UUID v4) pour permettre dédup. */
  id: string;
  /** URL canonique (déjà dédupliquée par le worker + scanner). */
  url: string;
  /** Titre principal (peut être vide pour sitemap sans title). */
  title: string;
  /** Texte intégral en clair (Readability `textContent` ou RSS sanitisé). */
  textContent: string;
  /** Résumé court (≤ 280 chars, propagé depuis `ExtractedArticle.excerpt`). */
  excerpt: string;
  /** Date de publication ISO 8601 (peut être `null` pour sitemap sans date). */
  publishedAt: string | null;
  /** ID de la source dont provient l'article. */
  sourceId: string;
  /** Type de la source. */
  sourceType: "rss" | "sitemap" | "api";
  /** Score final 0-100 arrondi à 1 décimale. `0` si `rejected`. */
  score: number;
  /** 4 composantes individuelles (toutes dans [0, 1], arrondies 1 déc.). */
  components: ScoreComponents;
  /** Score de promotion isolé dans [0, 100]. */
  promoScore: number;
  /** `true` si article rejeté binaire (promo ou vide). */
  rejected: boolean;
  /** Raison du rejet (aligné sur `ArticleScore.rejectionReason`). */
  rejectionReason?: "promotional_content" | "empty_content";
  /** ISO 8601 du moment d'extraction (propagé depuis `ExtractedArticle`). */
  extractedAt: string;
  /** ISO 8601 du moment du scoring (propagé depuis `ArticleScore`). */
  scoredAt: string;
  /** ID du batch parent (`scanId` du scanner). */
  scanId: string;
  /** UUID v4 du batch de persistance (un par appel `extractAndPersistAll`). */
  batchId: string;
  /**
   * Horodatage de persistance. À l'écriture : `serverTimestamp()` (résolu en
   * `Timestamp` par Firestore). À la lecture : `Timestamp` ou `null` si le
   * champ n'a pas été résolu (cas pathologique). Consumer story 2-5 doit
   * tester `instanceof Timestamp` avant `.toMillis()`.
   */
  persistedAt: Timestamp | null;
  /** `persistedAt + BATCH_RETENTION_MS` (résolu à l'écriture via `Timestamp.fromMillis`). */
  expiresAt: Timestamp | null;
  /**
   * `true` si l'article passe le seuil d'inclusion. **NON persisté** :
   * recalculé runtime par `loadPassingArticles(limit, minScore)`. Permet
   * changement de seuil (ex: 60 → 50) sans migration.
   */
  passing: boolean;
}
