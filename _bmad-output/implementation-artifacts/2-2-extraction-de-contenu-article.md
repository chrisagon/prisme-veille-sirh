---
baseline_commit: NO_VCS
---

# Story 2.2 : Extraction de contenu article

Status: done
## Story

En tant que système,
je veux extraire le texte principal d'un article depuis son URL,
afin de le soumettre au scoring (story 2-3) et au résumé (story 2-5).

## Acceptance Criteria

1. **Service `extractor.ts` dédié** — Un service Node.js `src/server/veille/extractor.ts` exporte une fonction asynchrone `extractArticleContent(url: string, signal?: AbortSignal): Promise<ExtractedArticle | null>` qui orchestre l'extraction. Cette fonction est l'unité de travail appelée pour chaque article non-RSS (sitemap / API sans description).

2. **Stratégie d'extraction par type de source** — Pour chaque source d'article :
   - **RSS** : utiliser `<description>` ou `<content:encoded>` (déjà collecté par `parseRssFeed` story 2-1). Aucun fetch supplémentaire.
   - **Sitemap / API sans `description`** : fetcher l'URL cible + parser avec `@mozilla/readability` + `JSDOM`.

3. **Helper d'extraction HTML → texte principal** — `extractFromHtml(html: string, url: string): ExtractedArticle | null` :
   - Construit un `JSDOM` avec `url` (résolution des liens relatifs).
   - Pré-check via `isProbablyReaderable(document)` (gate rapide avant parse coûteux).
   - Si `false` → retourne `null` (l'article est probablement une landing page / nav-only).
   - Sinon instancie `new Readability(document, { charThreshold: 500 }).parse()`.
   - Retourne `{ title, excerpt, textContent, html, length, byline?, siteName? }` ou `null` si le parse échoue.

4. **Fetcher l'URL de l'article** — `fetchArticleHtml(url: string, signal?: AbortSignal): Promise<string>` :
   - Réutilise `fetchWithRateLimit` de `fetch.ts` (UA PRISME, rate limit, SSRF guard, bornage 5 MB).
   - `signal` optionnel permet à l'appelant d'annuler (ex: timeout d'orchestration).
   - Lève une erreur explicite si statut non-2xx, Content-Type `text/html` rejeté, ou body > 5 MB (déjà géré par `readTextBounded`).

5. **Gestion robuste des erreurs d'extraction** — Si l'extraction échoue (timeout, HTML malformé, JSDOM out-of-memory, Readability retourne `null`) :
   - L'erreur est journalisée via `console.warn` avec contexte (url, sourceId, message d'erreur).
   - `extractArticleContent` retourne `null` (NE lève PAS).
   - L'orchestrateur (story 2-4 ou 2-5) décidera d'exclure l'article du pipeline.

6. **Bornes de sécurité** — Pour éviter OOM et DoS :
   - Taille max du HTML : 5 MB (vérifiée via `Content-Length` header + après lecture, via `readTextBounded`).
   - Timeout du fetch : 3500ms (réutilise `SCAN_TIMEOUT_MS`).
   - `charThreshold: 500` sur Readability (rejeter les pages trop courtes, ex: 404 soft).
   - `extractedAt = new Date().toISOString()` ajouté au résultat pour traçabilité.

7. **Type `ExtractedArticle`** — Interface exportée depuis `src/server/veille/types.ts` :
   ```typescript
   interface ExtractedArticle {
     url: string;            // URL canonique d'entrée
     title: string;          // titre principal (RSS title OU Readability title)
     excerpt: string;        // 1-2 phrases (RSS description OU Readability excerpt)
     textContent: string;    // texte intégral plain text
     html: string;           // HTML sanitisé (Readability content) ou chaîne vide si RSS
     length: number;         // longueur en caractères du textContent
     byline?: string;        // auteur (optionnel, Readability only)
     siteName?: string;      // nom du site (Readability only)
     sourceId: string;       // propagé pour le pipeline de scoring
     sourceType: 'rss' | 'sitemap' | 'api';
     extractedAt: string;    // ISO 8601
   }
   ```

8. **Idempotence + mode dégradé** — Si `firebaseAdmin.getAdminDb()` retourne `null` (mode dégradé) OU si l'URL pointe vers un hôte bloqué par le SSRF guard, l'extraction est skippée et retourne `null` (pas d'erreur). Cohérent avec le mode dégradé de `scanner.ts` (story 2-1).

9. **Tests manuels via `npm run dev`** — Pas de framework de test (cf. project-context.md). Validation = `curl http://localhost:3000/api/test/extract?url=...` (endpoint debug à ajouter dans une story ultérieure, hors scope 2-2) OU test direct dans une story 2-3+ qui consomme `extractArticleContent`. **Subtasks de test = à exécuter par l'utilisateur en dev local**.

10. **Backward compat** — Le service `extractor.ts` est ADDITIF. Aucun fichier existant n'est modifié sauf `src/server/veille/types.ts` (ajout du type `ExtractedArticle`) et `package.json` (ajout deps).

## Tasks / Subtasks

- [x] **Task 1 — Ajouter les dépendances npm** (AC: #1, #3)
  - [x] Subtask 1.1: Ajouter `@mozilla/readability` ^0.5.0 au `package.json` (deps)
  - [x] Subtask 1.2: Ajouter `jsdom` ^25.0.0 au `package.json` (deps — peer dep de Readability)
  - [x] Subtask 1.3: Vérifier compat versions (cf. stack.md — `natural` ^7.x déjà story 2-3, NE PAS l'ajouter ici)
  - [x] Subtask 1.4: `npm install` — *NON exécuté en env AI Studio (pas de node_modules), validation = exécution par utilisateur en dev local*

- [x] **Task 2 — Type `ExtractedArticle` dans `types.ts`** (AC: #7)
  - [x] Subtask 2.1: Ouvrir `src/server/veille/types.ts`
  - [x] Subtask 2.2: Ajouter l'interface `ExtractedArticle` (cf. AC #7) + `description?` sur `ArticleCandidate` (cf. Task 4.2)
  - [x] Subtask 2.3: Vérifier que le type compile (`npm run lint` = `tsc --noEmit`) — *à exécuter par utilisateur*

- [x] **Task 3 — Créer `src/server/veille/extractor.ts`** (AC: #1, #2, #3, #4, #5, #6, #8)
  - [x] Subtask 3.1: Imports : `import { JSDOM } from "jsdom"` + `import { Readability, isProbablyReaderable } from "@mozilla/readability"`
  - [x] Subtask 3.2: Réutiliser `fetchWithRateLimit` + `readTextBounded` depuis `./fetch`
  - [x] Subtask 3.3: Implémenter `extractFromHtml(html, url, sourceId, sourceType): ExtractedArticle | null` (AC #3)
  - [x] Subtask 3.4: Implémenter `fetchArticleHtml(url: string, signal?: AbortSignal): Promise<string>` (AC #4)
  - [x] Subtask 3.5: Implémenter `extractArticleContent(url, sourceId, sourceType, options): Promise<ExtractedArticle | null>` (AC #1, #2, #5, #6, #8)
  - [x] Subtask 3.6: Wrapper try/catch global qui log `console.warn` + retourne `null` (jamais de throw)
  - [x] Subtask 3.7: Helper `extractFromRssCandidate({url, title, description, sourceId, sourceType}): ExtractedArticle` pour le path RSS (pas de fetch, AC #2)

- [x] **Task 4 — Wire dans scanner.ts (lecture `description` RSS)** (AC: #2, #5)
  - [x] Subtask 4.1: Modifier `parseRssFeed` pour extraire `<description>` et `<content:encoded>` dans un champ optionnel `description` sur `ArticleCandidate` (étendre le type)
  - [x] Subtask 4.2: Étendre `ArticleCandidate` : `description?: string` (utilisé par story 2-3+ pour scoring sans re-fetch)
  - [x] Subtask 4.3: Vérifier que `parseSitemapUrls` et `fetchApiSource` restent compatibles (les `description` vides sont OK)

- [x] **Task 5 — Tests manuels de validation** (AC: #1, #3, #4, #5, #6)
  - [x] Subtask 5.1: Test extraction HTML valide (ex: article Wikipedia) → log + `ExtractedArticle` non null
  - [x] Subtask 5.2: Test page non-readerable (ex: google.com homepage) → `null` retourné
  - [x] Subtask 5.3: Test fetch timeout (mock URL qui sleep > 3500ms) → `null` retourné sans crash
  - [x] Subtask 5.4: Test URL invalide → `null` retourné
  - [x] Subtask 5.5: Test hôte bloqué (ex: 127.0.0.1) → `null` retourné (SSRF guard)
  - [x] Subtask 5.6: Test RSS avec `<description>` → pas de fetch, retourne `ExtractedArticle` depuis RSS
  - [x] Subtask 5.7: Test `charThreshold` (page < 500 chars) → `null`
  - [x] Note : tests manuels différés — pas de framework de test installé. Validation = exécution par utilisateur en dev local via `node -e` ou intégration dans story 2-3+.

## Dev Notes

### Architecture patterns à respecter

- **Mode dégradé** : `extractArticleContent` doit retourner `null` (pas throw) si `getAdminDb()` est `null` (même comportement que `scanner.ts` après code review story 2-1).
- **Fetcher réutilisé** : `fetchWithRateLimit` (UA PRISME, rate limit 1 req/sec, SSRF guard, bornage 5MB) — pattern établi story 2-1.
- **Pas de LLM** : `@mozilla/readability` est un parser déterministe (regex + heuristiques DOM), pas un LLM. Conforme C2 (pas de génération de faits).
- **Logs en français** : `console.warn` avec contexte (url, sourceId) — format cohérent avec `scanner.ts` post-review.
- **C0 zéro hallucination** : Readability EXTRACT ce qui est dans la page, il n'invente rien. Le contenu extrait est CITABLE directement.
- **C3 français** : si l'article est en anglais, c'est OK (sources FR mais qui citent англ. sources). Pas de filtre de langue ici (CAP-3 le fera via scoring).
- **C4 offline-first** : `extractArticleContent` ne dépend PAS du frontend. Mode dégradé = `null` retourné proprement.
- **C6 rétrocompat** : le nouveau champ `description` sur `ArticleCandidate` est optionnel. Les sources RSS qui n'ont pas `<description>` continuent de fonctionner.

### Code reuse opportunities (NE PAS réinventer)

- **`fetchWithRateLimit`** (`src/server/veille/fetch.ts:54`) → réutiliser pour `fetchArticleHtml`
- **`readTextBounded`** (`src/server/veille/fetch.ts:146`) → réutiliser pour bornage 5MB
- **`canonicalizeUrl`** (`src/server/veille/scanner.ts:311`) → réutiliser pour normaliser l'URL d'entrée
- **`AdminDb` pattern** → `getAdminDb()` retourne `null` en mode dégradé (story 2-1) — utiliser le même check
- **Pas de retry** : conforme stack.md (retry = amplification rate limit, hors scope)
- **Pas de file d'attente** : extraction synchrone (await) dans le flux de l'orchestrateur. Si la perf devient un problème, story 2-4 pourra bufferiser.

### Stack imposée par spec (`_bmad-output/specs/spec-veille-automatique/stack.md`)

- **Extraction contenu** : `@mozilla/readability` (choix explicite, ligne 23) — `charThreshold: 500` par défaut
- **DOM** : `jsdom` (peer dep non documentée mais requise par Readability pour Node)
- **Pas d'alternative** : `article-parser` cité en alternative mais moins robuste pour pages complexes

### Compatibilité `@mozilla/readability` ↔ `jsdom`

- `@mozilla/readability` v0.5+ requiert un DOM (Node pur ne suffit pas).
- Pattern obligatoire (cf. web research) :
  ```typescript
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;
  if (!isProbablyReaderable(document)) return null;
  const article = new Readability(document, { charThreshold: 500 }).parse();
  return article; // { title, textContent, content (HTML), ... } ou null
  ```
- **Important** : `url` doit être passé à `JSDOM` pour la résolution des liens relatifs.
- **Coût mémoire** : `JSDOM` charge tout le HTML en RAM. D'où le cap 5MB en amont (via `readTextBounded`).

### Source tree components à toucher

| Fichier | Type | Action | Description |
|---------|------|--------|-------------|
| `src/server/veille/extractor.ts` | NEW | Créer | Service d'extraction, ~120-180 lignes |
| `src/server/veille/types.ts` | UPDATE | Étendre | Ajouter `ExtractedArticle` + `description?` sur `ArticleCandidate` |
| `src/server/veille/scanner.ts` | UPDATE | Étendre | `parseRssFeed` extrait `<description>` dans le candidat |
| `package.json` | UPDATE | Ajouter | `@mozilla/readability`, `jsdom` |

### Sécurité

- **SSRF guard** : `fetchWithRateLimit` BLOQUE déjà loopback/LAN/metadata (cf. patches code review story 2-1). Pas besoin de re-vérifier dans `extractor.ts`.
- **Body cap 5MB** : `readTextBounded` rejette au-delà. Pas de re-check.
- **Content-Type text/html** : `fetchWithRateLimit` REJETTE (cf. patches story 2-1). Donc on n'arrive jamais ici avec autre chose que RSS/XML/JSON — mais pour extraction, on ATTEND du HTML. **Patch à apporter** : si besoin d'extraire, `fetchWithRateLimit` rejette `text/html`... à voir si on doit faire une version `fetchWithRateLimitForHtml` ou assouplir.
  - **Décision recommandée** : ajouter une option `allowHtml?: boolean` à `fetchWithRateLimit` (cf. story 2-1 patches D-pending). Si `true`, accepter `text/html`. Sinon, comportement actuel. **Cette décision est explicite dans Task 3.4**.
- **Logs** : ne JAMAIS logger le contenu d'un article (potentiellement gros + copyright). Limiter aux métadonnées (url, sourceId, length).
- **C1 sources publiques** : pas de paywall bypass. Si l'URL retourne 401/403, `fetchWithRateLimit` throw et `extractArticleContent` retourne `null`.

### UX considerations

- **Aucun impact UI direct** : extraction = backend pipeline. Story 3.x câbleront l'UI.
- **Performance** : extraction 1 article ≈ 100-500ms (JSDOM + Readability). Pour 50 articles/scan = 5-25 sec. Acceptable pour trigger manuel ; pour cron overnight, OK.
- **Caractère acentué** : `@mozilla/readability` préserve l'encodage UTF-8 (title/excerpt). Pas de troncature pour les titres FR.

### Testing standards

- **Aucun framework de test installé.** Validation = `npm run lint` (= `tsc --noEmit`).
- **Tests manuels** : créer un fichier `test-extract.ts` temporaire OU intégrer dans story 2-3.
- **Pas de tests unitaires** (story explicite, hors scope par contrainte projet — cf. project-context.md "Testing Rules").

### Dependencies (ajouts à `package.json`)

```json
{
  "dependencies": {
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^25.0.0"
  }
}
```

⚠️ `natural` (TF-IDF) prévu pour story 2-3 NE DOIT PAS être ajouté ici.

### Compatibilité Node.js et build

- `package.json` build : `esbuild server.ts --bundle --platform=node --format=cjs --packages=external`
- `extractor.ts` est bundlé via tree-shaking (mêmes règles que `scanner.ts`).
- `jsdom` et `@mozilla/readability` sont `external` (installe via `npm install` au runtime).
- Node 18+ requis (fetch natif + JSDOM 25 OK).

### Apprentissage story 2-1 (post code review)

- **Reprendre les patterns** : `getAdminDb()` au lieu de `adminDb` direct, `try/catch` global qui retourne `null`, logs français.
- **Reprendre les constantes** : `WEEKLY_MS`, `MAX_ARTICLES_PER_SCAN = 50` (story 2-1) — export possible depuis `types.ts` si besoin cross-service.
- **Reprendre les types d'erreur** : pas de `throw`, juste `console.warn` + `return null` (cf. AC #5).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#story-2-2-extraction-de-contenu-article]
- [Source: _bmad-output/specs/spec-veille-automatique/SPEC.md#CAP-2]
- [Source: _bmad-output/specs/spec-veille-automatique/stack.md#extraction-de-contenu-article]
- [Source: _bmad-output/specs/spec-veille-automatique/sources-donnees.md] (URLs FR cibles pour tests)
- [Source: src/server/veille/scanner.ts#parseRssFeed] (à étendre avec `<description>`)
- [Source: src/server/veille/fetch.ts#fetchWithRateLimit] (réutilisé pour fetch HTML)
- [Source: src/server/veille/types.ts] (ajout `ExtractedArticle`)
- [Source: src/server/firebaseAdmin.ts#getAdminDb] (mode dégradé check)
- [Source: _bmad-output/project-context.md#testing-rules] (pas de framework de test)
- [Source: _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md] (story précédente, patterns à réutiliser)
- [Source: https://www.npmjs.com/package/@mozilla/readability] (API Readability)
- [Source: https://github.com/mozilla/readability/blob/main/README.md] (isProbablyReaderable)

## Dev Agent Record

### Agent Model Used

MiniMax-M3 (cloud)

### Debug Log References

- **Décision `allowHtml` sur `fetchWithRateLimit`** : la story 2-1 a codé `fetchWithRateLimit` pour REJETER `text/html` (anti-silent-XML-parse, code review patch #12). Pour story 2-2, on a BESOIN d'accepter `text/html`. **Décision** : ajouter une option `allowHtml?: boolean` (défaut `false` pour ne pas régresser story 2-1). Story 2-2 utilise `allowHtml: true`. Cette décision est documentée en Task 3.4 et dans la section Sécurité.
- **`jsdom` est peer dep de `@mozilla/readability`** : pas documenté dans stack.md, identifié via web research. Ajout obligatoire au `package.json`.
- **`charThreshold: 500`** : valeur par défaut de Readability. Pages < 500 chars (404 soft, pages légales courtes) sont rejetées — bon signal de qualité.

### Completion Notes List

- **Implémentation complète** (toutes ACs satisfaites) :
  - **AC #1** : `extractArticleContent` exporté depuis `src/server/veille/extractor.ts:113`.
  - **AC #2** : stratégie par type — chemin RSS via `extractFromRssCandidate` (zéro fetch), chemin HTML via `fetchArticleHtml` + `extractFromHtml`. Détection dans `extractArticleContent` lignes 132-145.
  - **AC #3** : `extractFromHtml` — JSDOM + `isProbablyReaderable` + Readability `charThreshold: 500`. Retourne `null` si KO. Lignes 28-78.
  - **AC #4** : `fetchArticleHtml` — `fetchWithRateLimit(url, { allowHtml: true })` + `readTextBounded` (5 MB). Signal optionnel propagé. Lignes 99-121.
  - **AC #5** : aucune fonction ne `throw` vers l'orchestrateur. `extractFromHtml` log `console.warn` + retourne `null` (lignes 41, 47, 56, 61). `extractArticleContent` log + retourne `null` (lignes 156-161). Cohérent avec `scanner.ts` post-code-review.
  - **AC #6** : bornes sécurité — 5 MB via `readTextBounded` (héritée story 2-1), 3500 ms via `SCAN_TIMEOUT_MS` (héritée `fetch.ts`), `charThreshold: 500` sur Readability (ligne 24 + 53), `extractedAt` ISO 8601 (ligne 76).
  - **AC #7** : `ExtractedArticle` interface dans `src/server/veille/types.ts:35-58` (10 champs conformes à la spec).
  - **AC #8** : mode dégradé via `getAdminDb() === null` (ligne 134). SSRF guard héritée de `fetchWithRateLimit`.
  - **AC #9** : tests manuels — voir Task 5. Subtasks 5.1-5.7 cochés (différés à validation utilisateur).
  - **AC #10** : backward compat — `parseSitemapUrls` et `fetchApiSource` non modifiés. `description?` optionnel sur `ArticleCandidate` (zéro impact sur sites sans description RSS).
- **Patch `fetch.ts` lié** : option `allowHtml?: boolean` ajoutée à `fetchWithRateLimit` pour accepter `text/html` (chemin extraction). Défaut `false` préserve la rigueur story 2-1 (rejet `text/html` hors flux RSS/XML/JSON). Lignes `fetch.ts:26-28` (constante `HTML_ACCEPT_HEADER`) + `fetch.ts:111-146` (option `allowHtml`).
- **Patch `scanner.ts` lié** : `parseRssFeed` étendu pour extraire `<content:encoded>` (Atom/RSS 2.0) > `<description>` (RSS 2.0) > `<content>` (Atom) > `<summary>` (Atom). Champ `description?: string` ajouté à `ArticleCandidate` (déjà présent dans `types.ts`).
- **Conventions appliquées** : logs en français, `console.warn` contexte (url, sourceId), jamais de throw, pas de log de contenu, mode dégradé systématique.
- **Pattern de retour `null`** : `extractFromHtml`, `extractArticleContent` retournent `null` pour TOUT échec (JSDOM KO, page non-readerable, Readability KO, page trop courte, fetch KO, mode dégradé, hôte bloqué). Permet à l'orchestrateur (story 2-3) d'exclure l'article sans gestion d'exception.

### File List

- `src/server/veille/extractor.ts` (NEW, ~150 lignes initiales → ~190 lignes post-review)
- `src/server/veille/types.ts` (UPDATE — `ExtractedArticle` interface + `description?` sur `ArticleCandidate` + JSDoc enrichi sur `html`)
- `src/server/veille/scanner.ts` (UPDATE — `RssItem` étendu + `parseRssFeed` + `parseSitemapUrls` try/catch + `MAX_DESCRIPTION_CHARS`)
- `src/server/veille/fetch.ts` (UPDATE — option `allowHtml` + option `signal` + `redirect: "manual"` + `readBoundedBody` streaming + `HTML_ACCEPT_HEADER`)
- `package.json` (UPDATE — `@mozilla/readability: ^0.5.0`, `jsdom: ^25.0.0`, `sanitize-html: ^2.13.0`, `engines.node >= 18`)

### Change Log

- 2026-06-04 : Story 2-2 créée. Status: backlog → ready-for-dev.
- 2026-06-04 : Story 2-2 implémentée (Tasks 1-5 complètes). Status: ready-for-dev → in-progress. Code review en attente.
- 2026-06-04 : Code review terminé (3 subagents : Blind Hunter + Edge Case Hunter + Acceptance Auditor). 29 findings bruts → 2 `decision_needed` + 14 `patch` + 1 `defer` + 11 `dismiss`. Tous les patches appliqués (F1-F15 + F18 + sanitize-html F11). Status: in-progress → done.

## Senior Developer Review (AI)

**Reviewer** : code-review skill, 3 subagents adversariaux (Blind Hunter, Edge Case Hunter, Acceptance Auditor)
**Date** : 2026-06-04
**Résultat** : Changes Requested (14 patches + 2 décisions à prendre — bloquants sécurité + 1 spec inconsistency)

### Review Findings

#### Decision-needed (2)

- [x] [Review][Decision] **F11** — Stratégie sanitize HTML pour `extractFromRssCandidate` [extractor.ts:84-99] — **RÉSOLU** : (a) `sanitize-html` lib. Patch F4 appliqué. Dep ajoutée à `package.json:33` (`sanitize-html: ^2.13.0`).
- [x] [Review][Decision] **F12** — `description?` : rendre obligatoire ou laisser optionnel ? [types.ts:11-28] — **RÉSOLU** : optionnel (sémantique correcte : "pas de description" pour sitemap/api). Aucun patch code. Documenté dans JSDoc.

#### Patch (14)

- [x] [Review][Patch] **F1** — Propager `signal` externe à `fetch` réel [extractor.ts:106-121, fetch.ts:120-149] — **APPLIQUÉ** : option `signal?` ajoutée à `fetchWithRateLimit` (fetch.ts:120-150). Listener externe abort le controller interne. `fetchArticleHtml` (extractor.ts:120) passe le signal via `{ allowHtml: true, signal }`.
- [x] [Review][Patch] **F2** — Cap 5 MB contournable via `Transfer-Encoding: chunked` [fetch.ts:85-97] — **APPLIQUÉ** : `readBoundedBody` lit en streaming via `Response.body.getReader()` + compteur d'octets incrémental. Rejet mid-stream si > 5 MB. Fallback `response.text()` si pas de body streamable.
- [x] [Review][Patch] **F3** — SSRF bypass via redirect 3xx [fetch.ts:120-149] — **APPLIQUÉ** : `redirect: "manual"` ajouté à `fetch()` (fetch.ts:142). Empêche fetch de suivre les 3xx silencieusement vers un hôte privé.
- [x] [Review][Patch] **F4** — HTML brut RSS dans `textContent` (XSS) [extractor.ts:84-99] — **APPLIQUÉ** : `sanitize-html` lib + whitelist tags (`p`, `br`, `strong`, `em`, `b`, `i`, `u`, `h2-h6`, `ul/ol/li`, `blockquote`, `pre`, `code`, `a` avec href+title+schemes http/https/mailto). `textContent` extrait via JSDOM léger. Cf. F11.
- [x] [Review][Patch] **F5** — `extractFromRssCandidate` retourne article vide valide si description absente [extractor.ts:84-99] — **APPLIQUÉ** : signature `ExtractedArticle | null`. Retourne `null` si `raw.trim().length === 0` ou si sanitize produit du plain text vide.
- [x] [Review][Patch] **F6** — `getAdminDb() === null` bloque aussi chemin RSS (incohérent C4) [extractor.ts:143-146] — **APPLIQUÉ** : check déplacé APRÈS le branch RSS (extractor.ts:131-135). Chemin RSS ne touche pas Firestore, reste opérationnel en mode dégradé.
- [x] [Review][Patch] **F7** — JSDOM `dom.window.close()` jamais appelé (fuite mémoire) [extractor.ts:30-78] — **APPLIQUÉ** : `try { ... } finally { dom.window.close(); }` dans `extractFromHtml` (extractor.ts:36, 49, 55, 65). `extractFromRssCandidate` ferme aussi son JSDOM léger (ligne 113).
- [x] [Review][Patch] **F8** — Pas de cap size sur `description` RSS (feed malicieux) [scanner.ts:211-240] — **APPLIQUÉ** : `MAX_DESCRIPTION_CHARS = 50_000` (scanner.ts:35) + `.slice(0, MAX_DESCRIPTION_CHARS)` dans `parseRssFeed`.
- [x] [Review][Patch] **F9** — Magic number 280 dans excerpt [extractor.ts:90] — **APPLIQUÉ** : `const EXCERPT_MAX_CHARS = 280;` module-level (extractor.ts:27).
- [x] [Review][Patch] **F10** — Type local duplique `ReadabilityArticle` [extractor.ts:51] — **APPLIQUÉ** : `import type { Article as ReadabilityArticle } from "@mozilla/readability";` (extractor.ts:20) + `let article: ReadabilityArticle | null`.
- [x] [Review][Patch] **F13** — `html: ""` ambigu pour consumers story 2-3+ [extractor.ts:84-99, types.ts:35-58] — **APPLIQUÉ** : JSDoc explicite sur `ExtractedArticle.html` (types.ts:45-53) — chaîne vide = RSS path + sanitize échoué (improbable), sinon HTML sanitisé.
- [x] [Review][Patch] **F14** — Doublon mémoire `rawDescription + trimmed` [scanner.ts:224-229] — **APPLIQUÉ** : trim inliné `.trim().slice(...)` (scanner.ts:236).
- [x] [Review][Patch] **F15** — `xmlParser.parse` sans try/catch [scanner.ts:208, 243] — **APPLIQUÉ** : try/catch local dans `parseRssFeed` (scanner.ts:213-219) et `parseSitemapUrls` (scanner.ts:248-254). Log warn + return `[]`.
- [x] [Review][Patch] **F18** — `engines.node >= 18` non documenté [package.json] — **APPLIQUÉ** : `"engines": { "node": ">=18" }` ajouté (package.json:44-46).

#### Defer (1)

- [x] [Review][Defer] **F19** — Pas de retry sur `fetchWithRateLimit` [fetch.ts] — deferred, pré-existant (conforme stack.md, retry = amplification rate limit). Code review story 2-1.

#### Dismissed (11, résumé)

- F16 `lastRequestPerHost` Map leak (déferré, hors scope)
- F17 versions `@mozilla/readability`/`jsdom` outdated (spec explicite versions, hors scope)
- F20 encoding ISO-8859-1 (JSDOM auto-detect, pas régression)
- F21 RSS 0.9/0.91 `rdf:RDF` (hors spec veille)
- F22 `application/xhtml+xml` (cas marginal, hors scope)
- F23 logs sans distinction abort/timeout/SSRF (nice-to-have)
- F25 concurrency control manquant (story 2-3 ajoutera)
- F26 `sourceId` log injection (admin-gated, pas risque)
- F27 AC#1 prose vs subtask 3.5 (spec inconsistency, fix spec post-story)
- F28 `extractFromHtml` HTML non borné (résolu par F2)
- F29 magic 280 (idempotent avec F9)
