# Triage consolidé — story 2-2

## Findings unifiés (après dédup, classés)

### HAUTE — `patch` (code fixable, fix non ambigu)

- **F1** — `signal` non propagé à `fetch` réel (côté `fetchArticleHtml` + `fetchWithRateLimit`)
  - source: `blind+edge+auditor`
  - location: `src/server/veille/extractor.ts:106-121`, `src/server/veille/fetch.ts:120-149`
  - detail: `fetchArticleHtml` check `signal?.aborted` mais ne le forward PAS à `fetch()`. `fetchWithRateLimit` a son propre AbortController 3500 ms. Caller's signal = no-op mid-flight. Bandwidth gaspillé sur abort. Fix: ajouter option `signal?` à `fetchWithRateLimit` et l'utiliser pour `fetch(url, { signal })` ; si aborté, throw. L'option `signal` externe prime/abort le controller interne.

- **F2** — Cap 5 MB contournable via `Transfer-Encoding: chunked`
  - source: `edge`
  - location: `src/server/veille/fetch.ts:85-97` (`readBoundedBody`)
  - detail: le check `content-length` n'attrape pas les réponses chunked (pas de CL). `response.text()` charge TOUT en RAM avant le `text.length > MAX_BODY_BYTES` check. OOM possible. Fix: stream-reader borné (compteur d'octets incrémental, throw si > 5 MB pendant la lecture).

- **F3** — SSRF bypass via redirect 3xx
  - source: `edge`
  - location: `src/server/veille/fetch.ts:120-149` (`fetchWithRateLimit`)
  - detail: `fetch` natif suit 3xx par défaut ; `isBlockedHost` ne check QUE l'URL initiale. Attaquant : `http://attacker.com/redirect-to-169.254.169.254/` → metadata cloud. Fix: `fetch(url, { redirect: "manual" })` OU revalider le `response.url` final avec `isBlockedHost` (cf. code review story 2-1 — déferré, F3 NON couvert).

- **F4** — HTML brut RSS dans `textContent` (XSS downstream)
  - source: `blind`
  - location: `src/server/veille/extractor.ts:84-99` (`extractFromRssCandidate`)
  - detail: `textContent` et `excerpt` portent du HTML éditeur (`<p>...</p>`, `<a>...</a>`). Si rendu via `dangerouslySetInnerHTML` = XSS. C0 (zéro hallucination) OK pour le contenu mais le XSS est un sink. Fix : sanitize HTML avec une lib légère (ex: `sanitize-html`, ou `dompurify`+jsdom) OU — vu que le RSS path est un fast-path et que sanitize est cher — extraire le plain text via une regex strip-HTML simple. **Décision à prendre** : choix lib vs regex.

- **F5** — `extractFromRssCandidate` retourne un `ExtractedArticle` vide valide si description absente
  - source: `blind+edge`
  - location: `src/server/veille/extractor.ts:84-99`
  - detail: si `candidate.description === undefined` ou `""` (chemin sitemap/api qui passe quand même par `extractFromRssCandidate` par bug futur), retourne `{ textContent: "", length: 0, ... }` valide → callers aval (story 2-3) traitent un article vide comme valide. Fix : retourner `null` si `text.length === 0` (aligner avec `extractFromHtml` qui throw `null` si trop court).

- **F6** — `getAdminDb() === null` au début bloque aussi le chemin RSS
  - source: `blind+edge`
  - location: `src/server/veille/extractor.ts:143-146`
  - detail: scanner continue en mode dégradé mémoire (génère un `ScanResult.articles: []` sans persister). Le chemin RSS d'extraction ne touche PAS Firestore. Le check au début de `extractArticleContent` retourne `null` pour le RSS path → en mode dégradé, AUCUN article RSS n'est jamais extrait. **Incohérent avec C4 offline-first**. Fix : déplacer le check `getAdminDb() === null` après le RSS path (ou ne l'appliquer qu'au chemin HTML qui pourrait être différé).

### MOYENNE — `patch`

- **F7** — JSDOM `dom.window.close()` jamais appelé
  - source: `blind+edge`
  - location: `src/server/veille/extractor.ts:30-78` (`extractFromHtml`)
  - detail: fuite mémoire long-running (50 articles/scan = 50 JSDOM instances non fermées). Fix : `try { ... } finally { dom.window.close(); }`.

- **F8** — Pas de cap size sur `description` côté RSS
  - source: `blind+edge`
  - location: `src/server/veille/scanner.ts:211-240` (`parseRssFeed`)
  - detail: feed malicieux peut attacher des MB de HTML dans `<content:encoded>`. Persisté dans `ArticleCandidate.description` puis potentiellement feed à JSDOM. Fix : `description = rawDescription.slice(0, MAX_DESCRIPTION_CHARS)` (constante ~50 KB).

- **F9** — Magic number 280 dans `extractFromRssCandidate.excerpt`
  - source: `blind`
  - location: `src/server/veille/extractor.ts:90`
  - detail: `text.slice(0, 280)` non nommé, incohérent avec `READABILITY_CHAR_THRESHOLD` nommé. Fix : `const EXCERPT_MAX_CHARS = 280;` module-level.

- **F10** — Type local pour `Readability` au lieu d'importer `Article`
  - source: `blind+edge`
  - location: `src/server/veille/extractor.ts:51`
  - detail: `let article: { title: ...; content: ...; ... } | null = null` duplique la signature. Risque de désync à l'upgrade de `@mozilla/readability`. Fix : `import type { Article as ReadabilityArticle } from "@mozilla/readability";` puis `let article: ReadabilityArticle | null = null;`.

### MOYENNE — `decision_needed`

- **F11** — Choix sanitize HTML pour RSS path
  - source: `blind` (dérivé de F4)
  - location: `src/server/veille/extractor.ts:84-99`
  - detail: F4 nécessite un sanitize mais le RSS path est un fast-path (no fetch). Trade-off perf (sanitize) vs XSS. Options : (a) `sanitize-html` (~200 KB, robuste), (b) `dompurify`+`jsdom` (déjà installé, mais heavyweight), (c) regex strip-HTML simple (risqué, footgun), (d) garder HTML et documenter que callers DOIVENT sanitizer (least-effort, sécurité par convention). Demander à l'utilisateur.

- **F12** — `description?` sur `ArticleCandidate` : rendre obligatoire ou laisser optionnel ?
  - source: `blind`
  - location: `src/server/veille/types.ts:11-28`
  - detail: scanner RSS peuple toujours `description` quand présent. Sitemap/API ne le peuplent jamais. Soit on garde optionnel (sémantique correcte : "pas de description"), soit on rend obligatoire et on met `""` pour sitemap/api. Demander à l'utilisateur.

### BASSE — `patch`

- **F13** — `html: ""` ambigu pour consumers story 2-3+
  - source: `edge`
  - location: `src/server/veille/extractor.ts:84-99` + `types.ts:35-58`
  - detail: story 2-3 ne peut pas distinguer "RSS path (donc HTML sera jamais calculé)" de "HTML extraction a échoué (mais on n'a pas throw)". Fix: changer `html: string` en `html?: string` (ou `html: string | null`). Note : story 2-2 spec dit "chaîne vide si chemin RSS" — la spec est explicite, donc on garde `""` ET on documente dans JSDoc. Patch = JSDoc only.

- **F14** — Doublon mémoire `rawDescription + trimmed` dans scanner
  - source: `edge`
  - location: `src/server/veille/scanner.ts:224-229`
  - detail: `const rawDescription = ...; const description = rawDescription.trim();` alloue 2 strings. Fix : inliner le trim.

- **F15** — `xmlParser.parse` sans try/catch
  - source: `edge`
  - location: `src/server/veille/scanner.ts:208, 212, 227, 243`
  - detail: XML malformé throw non catché. Caller (`scanSource`) a un try/catch global (ligne 528) donc crash absorbé. Pas critique mais pourrait logger "Source RSS a échoué" sans le motif précis. Fix : try/catch local dans `parseRssFeed`/`parseSitemapUrls`, log warn, return `[]`.

- **F16** — `lastRequestPerHost` Map non nettoyée
  - source: `edge`
  - location: `src/server/veille/fetch.ts:61`
  - detail: fuite long-running pour crawler beaucoup de domaines. Pas critique pour 50 sources. Déferré.

- **F17** — Versions `@mozilla/readability ^0.5.0` et `jsdom ^25.0.0` outdated
  - source: `edge`
  - location: `package.json:15, 24`
  - detail: juin 2026 → 0.6.x et 29.x dispos. Pas bloquant. **Hors scope story 2-2** (spec explicite les versions).

- **F18** — `engines.node >= 18` non documenté dans package.json
  - source: `blind`
  - location: `package.json`
  - detail: `jsdom@25` requiert Node 18+. Pas de champ `engines`. Pas bloquant. À ajouter quand même.

### BASSE — `defer` (pré-existant, hors scope 2-2)

- **F19** — Pas de retry sur `fetchWithRateLimit`
  - source: code review story 2-1 (déjà déferré)
  - location: `src/server/veille/fetch.ts`
  - detail: conforme stack.md (retry = amplification rate limit). Pas un problème story 2-2.

### BASSE — `dismiss`

- **F20** — Encoding ISO-8859-1 cassé pour legacy sites FR
  - source: `edge`
  - detail: JSDOM détecte normalement l'encoding via meta tag. Pas une régression story 2-2. Pas d'AC story 2-2 ne couvre. À noter.

- **F21** — Flux RSS 0.9/0.91 (`rdf:RDF`) non supportés
  - source: `edge`
  - detail: spec veille-automatique ne cible que RSS 2.0 + Atom (cf. sources-donnees.md). Hors scope.

- **F22** — `application/xhtml+xml` jamais testé
  - source: `edge`
  - detail: AC #4 dit "Content-Type text/html" rejeté. `xhtml+xml` est un cas marginal. Pas de source FR connue qui sert du XHTML. Hors scope.

- **F23** — Logs uniformes sans distinction abort/timeout/SSRF
  - source: `edge`
  - detail: nice-to-have, pas de régression. Future story.

- **F24** — `description?: string` markée optionnelle mais scanner.populated
  - source: `blind` (idempotent avec F12)
  - dismiss: même sujet, traité en F12 (decision_needed).

- **F25** — Concurrency control manquant sur `extractArticleContent`
  - source: `blind`
  - dismiss: pipeline de scoring (story 2-3) ajoutera naturellement un limiteur. Pas un problème story 2-2.

- **F26** — `sourceId` log injection si untrusted
  - source: `blind`
  - dismiss: `sourceId` provient de Firestore (`veille_sources/{id}`) qui est admin-gated. Pas de risque d'injection depuis config utilisateur.

- **F27** — AC#1 prose vs subtask 3.5 inconsistency
  - source: `auditor`
  - dismiss: spec inconsistency, pas un bug code. À corriger dans le spec (post-story).

- **F28** — `extractFromHtml` accepte HTML non borné
  - source: `blind`
  - dismiss: en pratique borné en amont par `readTextBounded` (qui a le bug F2 mais c'est un autre sujet). F2 fix = F28 résolu.

- **F29** — Magic 280 string pas nommé
  - source: `blind` (idempotent avec F9)
  - dismiss: traité en F9.

---

## Counts

- Total findings bruts : 51 (16 BH + 20 ECH + 15 AC#)
- Après dédup : 29 findings
- **patch** : 12 (F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F13, F14, F15, F18 — note 14)
- **decision_needed** : 2 (F11, F12)
- **defer** : 1 (F19)
- **dismiss** : 11 (F16, F17, F20-F29)
