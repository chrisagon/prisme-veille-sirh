/**
 * Service d'extraction de contenu article.
 * Cf. _bmad-output/implementation-artifacts/2-2-extraction-de-contenu-article.md
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2 — extraction)
 *
 * Responsabilités :
 * - Extraire le texte principal d'un article depuis son URL via @mozilla/readability.
 * - Réutiliser le `<description>` / `<content:encoded>` RSS sans re-fetch.
 * - Gérer les erreurs proprement (jamais de throw, retourner `null`).
 * - Respecter le mode dégradé (Firestore indispo → `null` pour le chemin HTML ;
 *   le chemin RSS ne touche pas Firestore et reste opérationnel).
 * - Bornage sécurité : 5 MB max, 3500ms timeout, `charThreshold: 500`.
 *
 * Anti-hallucination (C0) : Readability EXTRACT ce qui est dans la page HTML,
 * il n'invente aucun fait. Le contenu retourné est CITABLE directement.
 */

import { JSDOM } from "jsdom";
import { Readability, isProbablyReaderable, type Article as ReadabilityArticle } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";
import { fetchWithRateLimit, readTextBounded } from "./fetch";
import { getAdminDb } from "../firebaseAdmin";
import { ExtractedArticle } from "./types";

/** Seuil minimum de caractères pour considérer une page comme un article (Readability). */
const READABILITY_CHAR_THRESHOLD = 500;

/** Longueur max de l'excerpt (résumé court) pour le chemin RSS. */
const EXCERPT_MAX_CHARS = 280;

// Whitelist de tags autorisée par sanitize-html pour le contenu RSS.
// On conserve la structure éditoriale (titres, listes, citations, code) sans
// autoriser les sinks XSS (script, iframe, on* handlers, javascript: URLs).
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "b", "i", "u",
    "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a",
  ],
  allowedAttributes: {
    a: ["href", "title"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Drop tout le reste (script, style, iframe, object, embed, on*, etc.).
  disallowedTagsMode: "discard",
};

/** Extrait le contenu textuel principal d'un document HTML via Readability.
 * Retourne `null` si la page n'est pas considérée comme un article lisible
 * (heuristique `isProbablyReaderable` KO) ou si Readability échoue.
 */
export function extractFromHtml(
  html: string,
  url: string,
  sourceId: string,
  sourceType: "rss" | "sitemap" | "api",
): ExtractedArticle | null {
  let document: Document;
  let dom: JSDOM | null = null;
  try {
    dom = new JSDOM(html, { url });
    document = dom.window.document;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[extractor] JSDOM KO pour ${url} (${sourceId}) : ${message}`);
    if (dom) {
      try { dom.window.close(); } catch { /* best-effort */ }
    }
    return null;
  }

  if (!isProbablyReaderable(document)) {
    console.warn(`[extractor] page probablement non lisible, skip ${url} (${sourceId})`);
    try { dom.window.close(); } catch { /* best-effort */ }
    return null;
  }

  let article: ReadabilityArticle | null = null;
  try {
    article = new Readability(document, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[extractor] Readability KO pour ${url} (${sourceId}) : ${message}`);
    try { dom.window.close(); } catch { /* best-effort */ }
    return null;
  } finally {
    // F7 : ferme le window JSDOM pour libérer la mémoire (fuite long-running).
    try { dom.window.close(); } catch { /* best-effort */ }
  }

  if (!article || !article.textContent || article.textContent.trim().length < READABILITY_CHAR_THRESHOLD) {
    console.warn(`[extractor] article trop court (< ${READABILITY_CHAR_THRESHOLD} chars), skip ${url} (${sourceId})`);
    return null;
  }

  return {
    url,
    title: article.title ?? "",
    excerpt: article.excerpt ?? "",
    textContent: article.textContent,
    html: article.content ?? "",
    length: article.length ?? article.textContent.length,
    byline: article.byline,
    siteName: article.siteName,
    sourceId,
    sourceType,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * Construit un `ExtractedArticle` à partir d'un candidat RSS qui porte déjà
 * un `<description>` / `<content:encoded>`. Aucun fetch HTTP — chemin rapide.
 *
 * F4 : le HTML brut RSS est sanitizé via `sanitize-html` (whitelist tags) puis
 * stocké dans `html`. Le plain text est extrait depuis ce HTML sanitizé pour
 * `textContent` et `excerpt` (évite le XSS downstream si rendu via React).
 *
 * F5 : retourne `null` si la description est vide ou absente (aligne avec
 * `extractFromHtml` qui throw `null` si trop court).
 */
export function extractFromRssCandidate(
  candidate: { url: string; title: string; description?: string; sourceId: string; sourceType: "rss" },
): ExtractedArticle | null {
  const raw = candidate.description ?? "";
  if (raw.trim().length === 0) {
    return null;
  }
  const sanitized = sanitizeHtml(raw, SANITIZE_OPTIONS);
  // Plain text : strip résiduel via sanitize-html (allowedTags sans texte brut).
  // On extrait le textContent via un JSDOM léger pour ne pas dépendre d'une 2e lib.
  let plain = sanitized;
  try {
    const tmp = new JSDOM(`<div>${sanitized}</div>`);
    plain = tmp.window.document.body.textContent ?? sanitized;
    tmp.window.close();
  } catch {
    plain = sanitized;
  }
  const trimmed = plain.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return {
    url: candidate.url,
    title: candidate.title,
    excerpt: trimmed.slice(0, EXCERPT_MAX_CHARS),
    textContent: trimmed,
    html: sanitized,
    length: trimmed.length,
    sourceId: candidate.sourceId,
    sourceType: candidate.sourceType,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * Fetcher une page d'article HTML via `fetchWithRateLimit` (allowHtml=true)
 * et lire le body borné à 5 MB.
 * Le paramètre `signal` optionnel permet à l'appelant d'annuler (ex: timeout d'orchestration).
 * Le signal est propagé jusqu'à `fetch()` via `fetchWithRateLimit` (cf. F1).
 */
export async function fetchArticleHtml(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error(`Annulation demandée avant fetch de ${url}`);
  }
  const response = await fetchWithRateLimit(url, { allowHtml: true, signal });
  const text = await readTextBounded(response);
  if (signal?.aborted) {
    throw new Error(`Annulation demandée pendant lecture de ${url}`);
  }
  return text;
}

/**
 * Orchestrateur d'extraction. Appelé par le pipeline de scoring (story 2-3+).
 *
 * - `candidate` : issu du scanner (story 2-1). Si `sourceType === 'rss'` ET
 *   `description` non vide → chemin RSS rapide (pas de fetch, ne touche pas
 *   Firestore, reste opérationnel en mode dégradé).
 * - `signal` optionnel pour permettre à l'orchestrateur d'annuler.
 *
 * Retourne `null` si :
 * - chemin HTML et Firestore indispo (mode dégradé)
 * - URL invalide ou hôte bloqué (SSRF)
 * - Fetch / extraction échoue (log warn, jamais throw)
 * - Page trop courte pour Readability
 * - Description RSS absente ou vide (F5)
 */
export async function extractArticleContent(
  url: string,
  sourceId: string,
  sourceType: "rss" | "sitemap" | "api",
  options: { description?: string; title?: string; signal?: AbortSignal } = {},
): Promise<ExtractedArticle | null> {
  // F6 : le check Firestore ne s'applique qu'au chemin HTML. Le chemin RSS est
  // local (pas de fetch, pas de LLM) et reste opérationnel en mode dégradé.
  if (sourceType === "rss" && options.description && options.description.trim().length > 0) {
    return extractFromRssCandidate({
      url,
      title: options.title ?? "",
      description: options.description,
      sourceId,
      sourceType,
    });
  }

  if (getAdminDb() === null) {
    console.warn(`[extractor] mode dégradé (Firestore indispo), skip ${url}`);
    return null;
  }

  try {
    const html = await fetchArticleHtml(url, options.signal);
    return extractFromHtml(html, url, sourceId, sourceType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[extractor] échec extraction ${url} (${sourceId}) : ${message}`);
    return null;
  }
}
