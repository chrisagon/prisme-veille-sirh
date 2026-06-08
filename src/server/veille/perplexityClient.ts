/**
 * Client Perplexity via OpenRouter (remplace geminiClient.ts).
 *
 * - Singleton lazy : `getPerplexityClient()` ne throw jamais.
 * - Sans clé API : le client est créé avec un placeholder ("MOCK_KEY").
 *   Les callers doivent tester `isPerplexityConfigured()` avant d'appeler
 *   l'API (mode dégradé).
 * - `isPerplexityConfigured()` permet aux callers de fail-fast
 *   proprement (return null) au lieu d'attendre un crash 401/403.
 * - C3 logs en français.
 * - OpenRouter est compatible OpenAI SDK : base_url = https://openrouter.ai/api/v1
 */

import OpenAI from "openai";

/** Modèles Perplexity disponibles via OpenRouter. */
export const PERPLEXITY_MODELS = {
  sonar: "perplexity/sonar",
  sonarPro: "perplexity/sonar-pro",
  deepResearch: "perplexity/sonar-deep-research",
  reasoningPro: "perplexity/sonar-reasoning-pro",
} as const;

export type PerplexityModel = (typeof PERPLEXITY_MODELS)[keyof typeof PERPLEXITY_MODELS];

/** Modèle par défaut pour la veille hebdomadaire. */
export const DEFAULT_MODEL: PerplexityModel = PERPLEXITY_MODELS.deepResearch;

let _client: OpenAI | null = null;

/**
 * Indique si la clé API OpenRouter est configurée. Les callers doivent tester
 * ce flag avant tout appel réel et retourner `null` (mode dégradé) si false.
 */
export function isPerplexityConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 0;
}

/**
 * Retourne le client OpenAI pointé vers OpenRouter (singleton).
 * Crée l'instance au premier appel. Si `OPENROUTER_API_KEY` est absent, crée
 * tout de même un client avec placeholder (les callers doivent vérifier
 * la clé avant d'invoquer l'API via `isPerplexityConfigured()`).
 */
export function getPerplexityClient(): OpenAI {
  if (_client) return _client;
  if (!isPerplexityConfigured()) {
    console.warn(
      "⚠️ [perplexityClient] OPENROUTER_API_KEY absente. Mode dégradé : les appels API échoueront.",
    );
  }
  _client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || "MOCK_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://prisme-hr.fr",
      "X-Title": "PRISME Veille",
    },
  });
  return _client;
}