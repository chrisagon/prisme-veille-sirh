# Story 2-2 Diff (synthetic — no VCS available)

## File 1: `src/server/veille/extractor.ts` (NEW, 168 lines)

```typescript
/**
 * Service d'extraction de contenu article.
 * Cf. _bmad-output/implementation-artifacts/2-2-extraction-de-contenu-article.md
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-2 — extraction)
 *
 * Responsabilités :
 * - Extraire le texte principal d'un article depuis son URL via @mozilla/readability.
 * - Réutiliser le `<description>` / `<content:encoded>` RSS sans re-fetch.
 * - Gérer les erreurs proprement (jamais de throw, retourner `null`).
 * - Respecter le mode dégradé (Firestore indispo → `null`).
 * - Bornage sécurité : 5 MB max, 3500ms timeout, `charThreshold: 500`.
 *
 * Anti-hallucination (C0) : Readability EXTRACT ce qui est dans la page HTML,
 * il n'invente aucun fait. Le contenu retourné est CITABLE directement.
 */

import { JSDOM } from "jsdom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { fetchWithRateLimit, readTextBounded } from "./fetch";
import { getAdminDb } from "../firebaseAdmin";
import { ExtractedArticle } from "./types";

/** Seuil minimum de caractères pour considérer une page comme un article (Readability). */
const READABILITY_CHAR_THRESHOLD = 500;

export function extractFromHtml(
  html: string,
  url: string,
  sourceId: string,
  sourceType: "rss" | "sitemap" | "api",
): ExtractedArticle | null {
  let document: Document;
  try {
    const dom = new JSDOM(html, { url });
    document = dom.window.document;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[extractor] JSDOM KO pour ${url} (${sourceId}) : ${message}`);
    return null;
  }

  if (!isProbablyReaderable(document)) {
    console.warn(`[extractor] page probablement non lisible, skip ${url} (${sourceId})`);
    return null;
  }

  let article: { title: string; content: string; textContent: string; length: number; excerpt: string; byline?: string; siteName?: string } | null = null;
  try {
    article = new Readability(document, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[extractor] Readability KO pour ${url} (${sourceId}) : ${message}`);
    return null;
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

export function extractFromRssCandidate(
  candidate: { url: string; title: string; description?: string; sourceId: string; sourceType: "rss" },
): ExtractedArticle {
  const text = candidate.description ?? "";
  return {
    url: candidate.url,
    title: candidate.title,
    excerpt: text.slice(0, 280),
    textContent: text,
    html: "",
    length: text.length,
    sourceId: candidate.sourceId,
    sourceType: candidate.sourceType,
    extractedAt: new Date().toISOString(),
  };
}

export async function fetchArticleHtml(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error(`Annulation demandée avant fetch de ${url}`);
  }
  const response = await fetchWithRateLimit(url, { allowHtml: true });
  const text = await readTextBounded(response);
  if (signal?.aborted) {
    throw new Error(`Annulation demandée pendant lecture de ${url}`);
  }
  return text;
}

export async function extractArticleContent(
  url: string,
  sourceId: string,
  sourceType: "rss" | "sitemap" | "api",
  options: { description?: string; title?: string; signal?: AbortSignal } = {},
): Promise<ExtractedArticle | null> {
  if (getAdminDb() === null) {
    console.warn(`[extractor] mode dégradé (Firestore indispo), skip ${url}`);
    return null;
  }

  if (sourceType === "rss" && options.description && options.description.trim().length > 0) {
    return extractFromRssCandidate({
      url,
      title: options.title ?? "",
      description: options.description,
      sourceId,
      sourceType,
    });
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
```

## File 2: `src/server/veille/types.ts` (UPDATE — delta)

**Added field to `ArticleCandidate`:**
```typescript
export interface ArticleCandidate {
  url: string;
  title: string;
  publishedAt: string | null;
  sourceId: string;
  sourceType: "rss" | "sitemap" | "api";
  /** NEW for story 2-2 */
  description?: string;
}
```

**NEW interface `ExtractedArticle`:**
```typescript
export interface ExtractedArticle {
  url: string;
  title: string;
  excerpt: string;
  textContent: string;
  html: string;
  length: number;
  byline?: string;
  siteName?: string;
  sourceId: string;
  sourceType: "rss" | "sitemap" | "api";
  extractedAt: string;
}
```

## File 3: `src/server/veille/scanner.ts` (UPDATE — delta)

**Extended `RssItem` interface:**
```typescript
interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  "atom:link"?: { "@_href"?: string };
  published?: string;
  updated?: string;
  // NEW story 2-2:
  description?: string;
  "content:encoded"?: string;
  "content"?: string;
  summary?: string;
}
```

**Rewritten `parseRssFeed` to extract `description`:**
```typescript
function parseRssFeed(xmlText: string, sourceId: string): ArticleCandidate[] {
  const parsed = xmlParser.parse(xmlText);
  const rss = parsed.rss ?? parsed.feed;
  if (!rss) return [];
  const channel = rss.channel ?? rss;
  const itemsRaw = channel.item ?? channel.entry;
  if (!itemsRaw) return [];
  const items: RssItem[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
  return items
    .map((item) => {
      const rawDescription =
        pickText(item["content:encoded"]) ||
        pickText(item.description) ||
        pickText(item.content) ||
        pickText(item.summary);
      const description = rawDescription.trim();
      return {
        url: firstLink(item),
        title: pickText(item.title).trim(),
        publishedAt: firstDate(item),
        sourceId,
        sourceType: "rss" as const,
        ...(description ? { description } : {}),
      };
    })
    .filter((c) => c.url.length > 0);
}
```

## File 4: `src/server/veille/fetch.ts` (UPDATE — delta)

**Added constants:**
```typescript
const ACCEPT_HEADER =
  "application/rss+xml, application/xml, text/xml, application/json";
const HTML_ACCEPT_HEADER =
  "text/html, application/xhtml+xml";
```

**Updated `fetchWithRateLimit` signature:**
```typescript
export async function fetchWithRateLimit(
  url: string,
  options: { headers?: Record<string, string>; allowHtml?: boolean } = {},
): Promise<Response> {
  // ... existing validation, SSRF guard, rate limit, AbortController ...
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.allowHtml ? HTML_ACCEPT_HEADER : ACCEPT_HEADER,
        ...options.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (!options.allowHtml) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("text/html")) {
        throw new Error(`Content-Type text/html non supporté (attendu RSS/XML/JSON)`);
      }
    }
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## File 5: `package.json` (UPDATE — delta)

```json
{
  "dependencies": {
    // ... existing ...
    "@mozilla/readability": "^0.5.0",  // NEW
    "jsdom": "^25.0.0"                 // NEW
  }
}
```

---

## SPEC CONTEXT

From `_bmad-output/specs/spec-veille-automatique/SPEC.md` (CAP-2):
- C0: zéro hallucination (Readability = extracteur déterministe, pas LLM)
- C1: sources publiques uniquement (http/https)
- C2: pas d'appel LLM dans scanner/extractor
- C3: logs en français
- C4: offline-first (mode dégradé si Firestore indispo)
- C5: admin-gated
- C6: backward compat avec `generateWeeklyAutoReport`

From `_bmad-output/implementation-artifacts/2-2-extraction-de-contenu-article.md`:
- 10 AC à valider
- Task 1-5 (5 tasks) avec 23 subtasks
- 4 fichiers touchés (1 NEW + 3 UPDATE) + 1 package.json

## PROJECT CONTEXT (for Edge Case Hunter)

- `src/server/veille/fetch.ts`: rate limit 1 req/sec/domain, SSRF guard, 5 MB cap, PRISME-Bot UA, 3500ms timeout
- `src/server/veille/scanner.ts`: scanner pipeline (CRON, dédup, gating temporel)
- `src/server/firebaseAdmin.ts`: getAdminDb() → null en mode dégradé
- `package.json`: build via esbuild externals
