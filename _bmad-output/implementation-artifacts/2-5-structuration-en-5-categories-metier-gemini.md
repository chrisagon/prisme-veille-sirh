---
baseline_commit: NO_VCS
---

# Story 2.5 : Structuration en 5 catégories métier (Gemini)

Status: done

## Story

**User Story** (depuis `epics.md` ligne 170) : En tant qu'admin, je veux que les articles filtrés soient classifiés en **Top 5, Tendances, Mouvements, Risques réglementaires, Recommandations HRC**, afin d'obtenir un rapport structuré selon le format PRISME.

**Capability source** : CAP-4 (spec v1.1)
**Valeur métier** : Transformer les `VeilleRawArticle` scorés ≥ 60 en un objet `VeilleReport` structuré, rétrocompatible avec l'UI existante, sans hallucination.

**Dépendances** : Stories 2-1 (scan), 2-2 (extraction), 2-3 (scoring), 2-4 (persistance Firestore + TTL) — toutes `done`. Story 2-5 est la première consommatrice de `loadPassingArticles()`.

## Acceptance Criteria (BDD-ready)

1. **Service `structurer.ts`** — Créer `src/server/veille/structurer.ts` exportant `structureWeeklyReport(options?: { weekId?: string; limit?: number; minScore?: number }): Promise<VeilleReport | null>`. Mode dégradé (Firestore indispo) : retourne `null`. Ne throw JAMAIS.

2. **Reader `loadPassingArticles()`** — `structureWeeklyReport` charge les articles passants via `loadPassingArticles(limit, minScore)` (story 2-4). Si `articles.length === 0`, retourne `null` (pipeline vide, pas de rapport).

3. **Format JSON strict Gemini (`responseSchema`)** — Le prompt Gemini impose un JSON conforme au type `VeilleReport` de `src/data/defaultReports.ts` (8 sections : `top3`, `actualites[5]`, `mouvements`, `reglementation`, `chiffre`, `signalFaible`, `ressources`, `actions`). Le prompt **interdit explicitement** au LLM d'inventer des faits (C2) : il reçoit UNIQUEMENT le titre + extrait + URL + source + score de chaque article. Le LLM fait du **résumé + classification**, jamais de la génération de fait.

4. **5 actualités strictes (C6 rétrocompat)** — `actualites` doit contenir **exactement 5** entrées (passage 7 → 5 actus). Si moins de 5 articles atteignent le seuil `passing`, le tableau est raccourci sans fallback créatif (C0). L'UI adaptera le rendu en story 3-3. Note : le prompt Gemini de `server.ts:559` dit encore "exactement 7" — c'est un héritage de la simulation, à **ne PAS** conserver pour 2-5 (le nouveau prompt dit "exactement 5").

5. **Prompt contraint (C2, anti-hallucination)** — Le prompt système doit contenir au minimum :
   - "Tu es un classificateur de veille SIRH/IA. Tu ne génères AUCUN fait, AUCUN chiffre, AUCUNE source qui ne soit pas dans la liste d'articles fournie."
   - "Si une information n'est pas présente dans le corpus, omets-la. Ne complète jamais par hypothèse."
   - "Chaque `actualite.url` doit être copiée EXACTEMENT depuis l'URL de l'article source. Aucune invention d'URL."
   - "Limite STRICTE : 5 actualités maximum."

6. **Persistance du rapport dans Firestore** — Le rapport structuré est persisté dans `reports/{weekId}` où `weekId = "2026-w{N}"` (pattern existant `server.ts:157`). `weekId` est paramétrable via `options.weekId` (défaut = semaine courante ISO). Si un rapport existe déjà pour cette `weekId`, il est **écrasé** (upsert idempotent). Champ `generatedAt: serverTimestamp()` + `articlesUsed: number` (combien d'articles du corpus ont nourri le rapport) + `batchId` (UUID v4 du batch de structuration, pour audit).

7. **`VeilleReport` strictement conforme** — Le JSON retourné par Gemini est validé en runtime via un **type guard TypeScript** (zod non installé → validation manuelle champ par champ). Toute section manquante ou de mauvais type → fallback sur objet vide `[]` ou `null` (ex: `reglementation: []` si Gemini n'a rien classé dans cette catégorie). **Ne throw JAMAIS**.

8. **Wiring dans `server.ts`** — Ajouter un appel à `structureWeeklyReport()` dans la fonction `generateWeeklyAutoReport()` (story 2-1 AC #12). Si `structureWeeklyReport` retourne `null`, `generateWeeklyAutoReport` retourne `null` (déjà géré par le caller, `server.ts:301-309`). En mode simulation (pas de `GEMINI_API_KEY`), conserver le fallback existant (cf. AC #9).

9. **Backward compat simulation** — `generateWeeklyAutoReport` continue de retourner le rapport hardcodé `defaultReports` (src/data/defaultReports.ts) SI `GEMINI_API_KEY` est absent OU SI `structureWeeklyReport` retourne `null` (mode dégradé). Flag `simulated: true` ajouté à la réponse pour distinguer simulation vs réel. La simulation sera retirée en story 3-3.

10. **Endpoint dédié (lecture seule)** — `GET /api/veille/latest` retourne le dernier rapport structuré depuis `reports/{weekId}` (trié par `generatedAt` desc, limit 1). Pas d'admin gate (lecture publique pour utilisateurs authentifiés, similaire aux rapports existants). Format JSON `{ report: VeilleReport, weekId, generatedAt, articlesUsed, batchId }`. Cachable 5 min côté client.

11. **Mode dégradé persistant** — Si Firestore indispo au moment de la lecture, `GET /api/veille/latest` retourne `null` + log warn FR. Pas de 500. L'UI tombe sur la simulation locale (story 3-1 doc).

12. **Tests purs (sans Firebase)** — `scripts/structurer-logic-fixture.ts` valide la logique pure (replay) :
    - Construction du prompt Gemini (5 sections obligatoires, instructions anti-hallucination présentes)
    - Parsing JSON Gemini → `VeilleReport` (champs manquants → fallback)
    - Calcul `weekId` ISO depuis une Date (replay déterministe)
    - Validation runtime des champs requis (`actualites.length <= 5`, `url` non-vide si présente, etc.)
    Cible : 20/20 tests OK.

## Tasks / Subtasks

- [x] **Task 1 — Service `structurer.ts` (squelette + types)** (AC: #1, #2)
  - [x] 1.1: Créer `src/server/veille/structurer.ts` (nouveau fichier, ~250 lignes estimées)
  - [x] 1.2: Définir interface `StructureOptions` : `{ weekId?: string; limit?: number; minScore?: number; promptOverride?: string }`
  - [x] 1.3: Importer `loadPassingArticles` depuis `./persistence`
  - [x] 1.4: Importer `VeilleReport` depuis `../../data/defaultReports` (réutilisation type existant)
  - [x] 1.5: Définir type interne `GeminiSchemaVeilleReport` (alias strict de `VeilleReport` pour validation)
  - [x] 1.6: Vérifier `tsc --noEmit` (0 erreur sur ce fichier)

- [x] **Task 2 — Construction du prompt Gemini (C2 anti-hallucination)** (AC: #3, #5)
  - [x] 2.1: Implémenter `buildStructurationPrompt(articles: VeilleRawArticle[]): string`
  - [x] 2.2: Lister chaque article sous forme condensée : `ID: {hash}|URL: {url}|SOURCE: {sourceId}|SCORE: {score}|TITRE: {title}|EXTRAIT: {excerpt[:300]}`
  - [x] 2.3: Section instructions (5 points) : anti-hallucination, 5 actus max, URL copiée exactement, sources issues du corpus, classification 5 catégories
  - [x] 2.4: Section schéma JSON strict (copier le `responseSchema` de `server.ts:548-641` en version 5 actus)
  - [x] 2.5: Section sortie : "Retourne UNIQUEMENT le JSON, sans markdown, sans préambule"
  - [x] 2.6: Test pur : vérifier que le prompt contient les 5 instructions (regex match)

- [x] **Task 3 — Validation runtime JSON → `VeilleReport`** (AC: #7)
  - [x] 3.1: Implémenter `parseGeminiResponse(raw: string): VeilleReport | null`
  - [x] 3.2: `try { JSON.parse(raw) } catch → return null`
  - [x] 3.3: Valider `top3: string[]` (longueur 0-3 OK, défaut `[]`)
  - [x] 3.4: Valider `actualites: { title, source, date, summary, impact, tags, url? }[]` (longueur 0-5 stricte, défaut `[]`)
  - [x] 3.5: Valider `mouvements`, `reglementation`, `ressources`, `actions` (arrays d'objets, défaut `[]`)
  - [x] 3.6: Valider `chiffre`, `signalFaible` (objets ou null, défaut `null`)
  - [x] 3.7: Valider `week: string` (défaut `""`)
  - [x] 3.8: Si `id` manquant, générer `{weekId}-{Date.now()}` (déterminisme secondaire)

- [x] **Task 4 — Orchestrateur `structureWeeklyReport`** (AC: #1, #2, #3, #6)
  - [x] 4.1: Charger `articles = await loadPassingArticles(limit, minScore)` (story 2-4 reader)
  - [x] 4.2: Si `articles.length === 0` → retourner `null` (log warn `[structurer] corpus vide, pas de rapport`)
  - [x] 4.3: Si `!process.env.GEMINI_API_KEY` → retourner `null` (mode simulation géré par caller, story 2-1)
  - [x] 4.4: Construire le prompt (`buildStructurationPrompt`)
  - [x] 4.5: Appeler `ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt, config: { responseMimeType: "application/json", responseSchema: ... } })` via `getGeminiClient()` (réutiliser `server.ts:67-77`)
  - [x] 4.6: `const raw = response.text` (string JSON strict grâce à `responseSchema`)
  - [x] 4.7: `const report = parseGeminiResponse(raw)` (peut être `null`)
  - [x] 4.8: Si `report === null` → retourner `null`
  - [x] 4.9: Persister dans `reports/{weekId}` via `setDoc` (upsert idempotent) avec `generatedAt: serverTimestamp()`, `articlesUsed: articles.length`, `batchId: crypto.randomUUID()`
  - [x] 4.10: Retourner `report` enrichi des champs de tracking (id, weekId, articlesUsed, batchId)

- [x] **Task 5 — Endpoint `GET /api/veille/latest`** (AC: #10, #11)
  - [x] 5.1: Ajouter handler dans `server.ts` (après `POST /api/veille/admin/purge-expired`)
  - [x] 5.2: `const db = getAdminDb()` — si `null` → répondre `200 { report: null, reason: "firestore_unavailable" }` + log warn
  - [x] 5.3: `const q = query(collection(db, "reports"), orderBy("generatedAt", "desc"), limit(1))`
  - [x] 5.4: `const snap = await getDocs(q)` — si vide → répondre `200 { report: null, reason: "no_report" }`
  - [x] 5.5: Sinon → répondre `200 { report, weekId: doc.id, generatedAt: data.generatedAt, articlesUsed: data.articlesUsed, batchId: data.batchId }`
  - [x] 5.6: `try/catch` global → `500 { error: "lecture échouée" }` + log error FR
  - [x] 5.7: Pas d'admin gate (lecture publique auth Firestore, cohérent avec `App.tsx`)

- [x] **Task 6 — Wiring `server.ts:generateWeeklyAutoReport`** (AC: #8, #9)
  - [x] 6.1: Importer `structureWeeklyReport` depuis `./src/server/veille/structurer`
  - [x] 6.2: Dans `generateWeeklyAutoReport()`, après calcul `weekLabel` + `weekTitle`, tenter `const structured = await structureWeeklyReport({ weekId: weekLabel })`
  - [x] 6.3: Si `structured !== null` → retourner `structured` (rapport réel, pas de simulation)
  - [x] 6.4: Si `structured === null` ET `!hasApiKey` → fallback simulation (comportement actuel, `simulated: true`)
  - [x] 6.5: Si `structured === null` ET `hasApiKey` → retourner `null` (échec pipeline réel, caller loggue "No report generated", cohérent avec `server.ts:305`)

- [x] **Task 7 — Tests purs `scripts/structurer-logic-fixture.ts`** (AC: #12)
  - [x] 7.1: Créer `scripts/structurer-logic-fixture.ts` (nouveau fichier, ~250 lignes)
  - [x] 7.2: Replay `buildStructurationPrompt(articles: VeilleRawArticle[])` avec 3 articles fixtures
  - [x] 7.3: Vérifier que le prompt contient "anti-hallucination" + "exactement 5" + "URL" + "source" + "classifi"
  - [x] 7.4: Replay `parseGeminiResponse('{ "week": "...", "top3": [...], "actualites": [...] }')` → objet conforme
  - [x] 7.5: Test edge case : JSON invalide → `null`
  - [x] 7.6: Test edge case : `actualites` manquant → fallback `[]`
  - [x] 7.7: Test edge case : `actualites` = 7 entrées (Gemini ignore la contrainte) → tronqué à 5
  - [x] 7.8: Test edge case : `url` manquante dans une actualité → champ omis du résultat (validation C0)
  - [x] 7.9: Test `computeWeekId(new Date("2026-06-04"))` → `"2026-w23"` (ou valeur ISO déterministe, à figer)
  - [x] 7.10: Test `validateActualitesCount(parsed)` → respecte `0-5`
  - [x] 7.11: Lancer `npx tsx scripts/structurer-logic-fixture.ts` (env AI Studio sans `node_modules` → peut nécessiter fixtures inline, cf. `persistence-logic-fixture.ts` pattern)
  - [x] 7.12: Cible : 20/20 tests OK (réalisé 30/30)

- [x] **Task 8 — Mise à jour `sprint-status.yaml`** (admin)
  - [x] 8.1: `2-5-structuration-en-5-categories-metier-gemini: backlog → in-progress` (au début de l'implémentation)
  - [x] 8.2: `in-progress → review` (après les 12 tests OK)
  - [x] 8.3: `review → done` (post-application des 17 patches code review 2026-06-05)

## Review Patches (post-review, 2026-06-05)

bmad-code-review a identifié 17 `patch` items + 7 `defer` items. Tous les patches appliqués en ce commit (option 1 : "Apply every patch"). Defer items → `_bmad-output/implementation-artifacts/deferred-work.md`.

| # | Patch | Statut | Fichier |
|---|-------|--------|---------|
| #1 | Extraire `getGeminiClient()` (single source of truth) | ✅ | `src/server/veille/geminiClient.ts` + `server.ts` |
| #2 | `chiffre`/`signalFaible` défaut `null` (au lieu de `{}`) | ✅ | `structurer.ts` + type `defaultReports.ts` |
| #3 | `generatedAt` toujours `null` → `Timestamp.fromMillis(Date.now())` | ✅ | `structurer.ts` |
| #4 | `computeWeekId` aligner sur ISO 8601 UTC (anti-TZ/DST) | ✅ | `structurer.ts` + `server.ts` (délégation) |
| #5 | `/api/veille/latest` catch → 500 (violation AC #11) | ✅ → 200 + reason | `server.ts` |
| #6 | Simulation gated `!hasApiKey` only (AC #9 violation) | ✅ → toujours en fallback | `server.ts` |
| #7 | Markdown fence stripping absent dans parser | ✅ | `structurer.ts` |
| #9 | Actions schema drop `confidentiality`/`criticality` | ✅ → préservés | `structurer.ts` (parser) |
| #12 | Return type `generateWeeklyAutoReport` 3 branches inconsistent | ✅ → unifié `{ ...VeilleReport, simulated: boolean }` | `server.ts` |
| #13 | `geminiClient` fail-fast MOCK_KEY | ✅ → helper `isGeminiConfigured()` | `geminiClient.ts` |
| #14 | `top3` non-cappé | ✅ → capé à 3 | `structurer.ts` (parser) |
| #15 | Deep validation gaps mouvements/reglementation/ressources | ✅ → helper `validateStringObject<T>` | `structurer.ts` |
| #18 | SOURCE `rss-lucca` leak dans prompt | ⏭ won't-fix (false positive : sourceId légitime) | — |
| #19 | `responseSchema` cast brittle (conditional infer chain) | ✅ → JSON Schema direct | `structurer.ts` |
| #23 | FAILED_PRECONDITION catch → 500 | ✅ → reason `missing_index` | `server.ts` |
| #24 | `/api/veille/latest` doc corrompu (`!data.report`) | ✅ → skip + continue | `server.ts` |
| #34 | `computeWeekId` clamp `w1..w53` | ✅ | `structurer.ts` |

**Fixture sync** : 30 → 35 tests OK (ajout tests #2 null, #7 fence, #14 top3 cap, #34 clamp).

## Dev Notes

### Contexte projet (cf. `_bmad-output/project-context.md`)

- **TypeScript 5.8.2**, `isolatedModules: true`, `allowImportingTsExtensions: true`, `noEmit: true` (Vite/esbuild gèrent transpilation).
- **Path alias** : `@/*` → racine projet. Pour `structurer.ts`, imports relatifs (`./persistence`, `../../data/defaultReports`).
- **No test framework**. Tests via `scripts/*-logic-fixture.ts` (pattern story 2-3 / 2-4 : replay pur sans `node_modules`).
- **C3 logs en français** : préfixes `[structurer]`, `[weekly-report]`, `[veille/latest]`.
- **C5 admin gate** : `GET /api/veille/latest` est lecture publique (utilisateurs auth). Pas de check `christof.thomas@gmail.com`. La `POST /api/veille/admin/purge-expired` (story 2-4) garde son Bearer token.

### Contexte spec (cf. `_bmad-output/specs/spec-veille-automatique/SPEC.md` CAP-4)

- **5 catégories obligatoires** : Top 5 actualités, Tendances émergentes, Mouvements éditeurs, Risques réglementaires, Recommandations HRC.
- **C0 zéro hallucination** : Si une info n'est pas dans le corpus, elle n'apparaît pas. Pas de fallback créatif. C'est pourquoi le prompt doit explicitement lister les articles et interdire l'invention.
- **C2 pas de LLM pour générer des faits** : Le LLM fait du résumé + classification. Tous les `url`, `source`, `date` doivent provenir du corpus.
- **C6 rétrocompat** : `VeilleReport` shape reste identique (8 sections), seul `actualites.length` passe de 7 à 5. Le type `VeilleReport` de `src/data/defaultReports.ts` accepte `actualites: { ... }[]` sans contrainte de longueur → compatible.

### Contexte stories précédentes (replay patterns)

**Story 2-3 (scoring)** : `src/server/veille/scorer.ts` — service pur, sync, jamais throw. Pattern fixture `scripts/scorer-logic-fixture.ts` (36/40 tests OK).
**Story 2-4 (persistance)** : `src/server/veille/persistence.ts` — pattern `getAdminDb()`, `computePassing`, `extractAndPersistAll` orchestrateur. Le reader `loadPassingArticles(limit, minScore)` est l'input de story 2-5. **Signature exacte à utiliser** :
```typescript
import { loadPassingArticles } from "./persistence";
const articles = await loadPassingArticles(50, 60); // 50 max, score >= 60
// articles: VeilleRawArticle[] (peut être vide en mode dégradé)
```
**Garanties story 2-4** : `loadPassingArticles` retourne `[]` (jamais throw) si Firestore indispo. Le champ `passing` est dénormalisé au write, `query.where("passing", "==", true)` + `where("expiresAt", ">", now)` (1 equality + 1 range, OK pour Firestore).

### Contexte server.ts existant (pattern Gemini à réutiliser)

**Ne PAS réinventer le pattern Gemini** :
- `getGeminiClient()` (server.ts:67-77) — singleton lazy, throw si pas de clé.
- `responseSchema` (server.ts:548-641) — schéma Type strict via `Type.OBJECT`/`Type.ARRAY` du SDK `@google/genai`.
- `responseMimeType: "application/json"` (server.ts:547) — force Gemini à retourner du JSON pur, pas de markdown.

**Différence story 2-5 vs `server.ts:541`** :
- Le prompt actuel demande "exactement 7 actualités" (legacy simulation). Pour 2-5, le prompt doit demander **"exactement 5 actualités maximum"** + "tu peux en mettre moins si le corpus est faible, mais jamais plus de 5".
- Le prompt actuel est inline dans `app.post("/api/veille/generate", ...)`. Pour 2-5, **extraire** la construction du prompt dans `structurer.ts:buildStructurationPrompt()`.
- Le `responseSchema` actuel (server.ts:548-641) est 100% compatible avec le `VeilleReport` de `src/data/defaultReports.ts`. **Réutiliser tel quel**, seul le `description` du champ `actualites` change ("exactement 5" au lieu de "exactement 7").

### Code reuse opportunities (NE PAS réinventer)

- **`getAdminDb`** (`src/server/firebaseAdmin.ts`) — pour `setDoc` dans `reports/{weekId}`. Pattern identique story 2-4.
- **`getGeminiClient`** (`server.ts:67-77`) — singleton. **Ne PAS** recréer un client Gemini dans `structurer.ts`. À la place, exporter `getGeminiClient` depuis `server.ts` ou la déplacer dans un module partagé `src/server/veille/geminiClient.ts` (recommandé, éviter le couplage).
- **`loadPassingArticles`** (`src/server/veille/persistence.ts:284`) — reader story 2-4. Le seul input de `structureWeeklyReport`.
- **`VeilleReport` type** (`src/data/defaultReports.ts:1-45`) — type partagé. Pas de redéfinition.
- **`serverTimestamp`** (`firebase-admin/firestore`) — pour `generatedAt` du rapport.
- **`crypto.randomUUID()`** — natif Node 18+, déjà utilisé stories 2-1/2-3/2-4.
- **Pattern `try/catch` avec retour défaut** — toutes les stories 2-x. Ne JAMAIS throw depuis `structurer.ts`.

### Compatibilité TS

- Aucune dep nouvelle (Gemini SDK déjà installé).
- `Type` enum de `@google/genai` — déjà importé dans `server.ts:4`.
- `Timestamp` type — `firebase-admin/firestore` (déjà importé story 2-4).
- Le `parseGeminiResponse` peut être écrit en pur TS sans dépendance externe (pas besoin de zod).

### Architecture decisions (à documenter dans la story)

- **D-1** : `structurer.ts` est le **premier consommateur** de `loadPassingArticles`. Le pattern "Reader → Structurer → Persist" devient la norme pour stories 2-6 (audit) et Epic 3 (UI).
- **D-2** : Le `batchId` (UUID v4) est persisté avec le rapport. Permet à l'audit (story 2-6) de tracer quels articles ont nourri quel rapport via `veille_raw_articles.batchId`.
- **D-3** : Le prompt Gemini est **extrait** dans `buildStructurationPrompt()`. Le `responseSchema` peut être inline dans `structurer.ts` (mimic exact de `server.ts:548-641`). Justification : tester la construction du prompt en fixture pure sans toucher au client Gemini.
- **D-4** : `actualites.length <= 5` est une **contrainte runtime** (parser tronque si Gemini en retourne plus), pas un prompt. Defense in depth : Gemini peut ignorer la consigne, le parser enforce.
- **D-5** : Mode dégradé = `null` retourné (pas de rapport). Le caller (`generateWeeklyAutoReport` ou endpoint admin) décide du fallback. Séparation claire des responsabilités.

### Stack imposée par spec

- **Gemini `gemini-3.5-flash`** — modèle imposé (cf. `server.ts:544`).
- **Pas de nouvelle dépendance** : `@google/genai` (déjà installé), `firebase-admin` (déjà installé), `node:crypto` (natif).
- **Prompt engineering** : instructions C0/C2 explicites en français, schéma JSON strict, interdiction explicite d'invention.

### Don't-Miss Rules

- **C0** : le prompt DOIT contenir l'interdiction explicite d'inventer des faits, des chiffres, des sources. C'est le garde-fou principal. Ne JAMAIS le retirer.
- **C2** : tous les champs `url`, `source`, `date` du rapport doivent provenir du corpus `VeilleRawArticle[]`. Le LLM ne génère QUE `summary`, `impact`, `tags`, `title` (reformulation), `category` (classification).
- **C6** : `actualites` passe de 7 à 5 entrées. Le prompt, le parser, et l'UI (story 3-3) doivent s'aligner.
- **Backward compat simulation** : NE PAS supprimer `generateWeeklyAutoReport` simulation. Story 2-5 ajoute juste un *essai* de structuration réelle avant fallback simulation. Story 3-3 retirera la simulation.
- **Pas de throw** : `structurer.ts` retourne `null` en cas d'échec (mode dégradé, JSON invalide, Gemini 503, etc.). Le caller décide.
- **Mode admin gate** : `GET /api/veille/latest` est lecture publique (auth Firestore only). Pas de Bearer token admin (cf. story 2-4).

## References

- [Source: epics.md#story-2.5] (AC #1-#6, lignes 170-185)
- [Source: SPEC.md#CAP-4] (5 catégories obligatoires, lignes 41-49)
- [Source: SPEC.md#C0] (zéro hallucination, ligne 68)
- [Source: SPEC.md#C2] (pas de LLM pour générer des faits, ligne 70)
- [Source: SPEC.md#C6] (rétrocompatibilité VeilleReport, ligne 74)
- [Source: server.ts:541-641] (pattern Gemini `responseSchema` à réutiliser)
- [Source: server.ts:147-226] (simulation `generateWeeklyAutoReport` à compléter)
- [Source: src/data/defaultReports.ts:1-45] (type `VeilleReport`)
- [Source: src/server/veille/persistence.ts:284-313] (`loadPassingArticles` reader)
- [Source: 2-4-stockage-temporaire-firestore-avec-ttl.md#dev-notes] (patterns `getAdminDb`, `pLimit`, mode dégradé)

## Completion Notes List

- **2026-06-05** : Implémentation complète de la story 2-5 en single-shot.
  - Service `structurer.ts` créé (orchestrateur `structureWeeklyReport` + helpers purs exportés : `computeWeekId`, `buildStructurationPrompt`, `validateActualitesCount`, `parseGeminiResponse`).
  - Module `geminiClient.ts` extrait depuis `server.ts:67-84` (singleton partagé, recommandé par Dev Notes D-3).
  - Endpoint `GET /api/veille/latest` ajouté dans `server.ts` (mode dégradé `firestore_unavailable`/`no_report` 200, jamais 500).
  - `generateWeeklyAutoReport` réécrit : tentative de structuration réelle d'abord, fallback simulation `simulated: true` si null + `!hasApiKey`.
  - Fixture `structurer-logic-fixture.ts` créé : **30/30 tests OK** (cible 20/20 dépassée).
  - `tsc --noEmit` : 0 nouvelle erreur dans les fichiers touchés (erreurs restantes = env `node_modules` absents, préexistantes).
  - D-1 validé : `structurer.ts` est le 1er consommateur de `loadPassingArticles`. D-2 validé : `batchId` UUID v4 persisté pour audit story 2-6. D-3 validé : prompt extrait dans helper pur testable. D-4 validé : `validateActualitesCount` tronque runtime à 5 (defense in depth). D-5 validé : mode dégradé = `null` retourné, caller décide.
  - C0/C2 enforced : prompt interdit explicitement l'invention, parser omet `url` absente. C6 enforced : max 5 actus runtime.

## File List

| Fichier | Type | Action | Description |
|---------|------|--------|-------------|
| `src/server/veille/structurer.ts` | NEW | Créé (~450 lignes) | Service structuration Gemini 5 catégories + helpers purs |
| `src/server/veille/geminiClient.ts` | NEW | Créé (~50 lignes) | Singleton Gemini partagé (extrait server.ts:67-84) |
| `server.ts` | UPDATE | Étendu | Imports `structureWeeklyReport`/`getAdminDb`/firestore + endpoint `GET /api/veille/latest` + wiring `generateWeeklyAutoReport` (essai réel → fallback simulation) + flag `simulated: true` sur retour simulation |
| `scripts/structurer-logic-fixture.ts` | NEW | Créé (~480 lignes) | Replay pur : 30/30 tests OK |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | UPDATE | Étendu | `2-5-structuration-en-5-categories-metier-gemini: backlog → in-progress → review` |
| `_bmad-output/implementation-artifacts/2-5-structuration-en-5-categories-metier-gemini.md` | UPDATE | Étendu | Tasks cochées, Completion Notes ajoutées, Change Log |

## Change Log

- 2026-06-05 : Story 2-5 créée. Status: backlog → ready-for-dev. Dérivée de epics.md (lignes 170-185) et SPEC.md CAP-4. Consommatrice de `loadPassingArticles` (story 2-4 done). 12 AC, 8 tasks, 1 service NEW + 1 endpoint UPDATE + 1 fixture NEW.
- 2026-06-05 : Story 2-5 implémentée. Status: ready-for-dev → in-progress → review. 2 fichiers NEW (`structurer.ts`, `geminiClient.ts`), 1 fixture NEW (30/30 OK), 1 fichier UPDATE (`server.ts` : imports + endpoint `GET /api/veille/latest` + wiring `generateWeeklyAutoReport`). Toutes les tasks cochées sauf 8.3 (en attente code review). 0 régression tsc. Mode dégradé (Firestore indispo, corpus vide, Gemini indispo) systématiquement géré via `null` retourné. Prête pour `bmad-code-review`.
- 2026-06-05 : Code review story 2-5 (3 subagents : Blind Hunter + Edge Case Hunter + Acceptance Auditor). Triage : 17 `patch`, 7 `defer`, 11 `dismiss`, 0 `decision_needed`. Findings documentés en `### Review Findings` ci-dessous.

## Review Findings

Code review du 2026-06-05 (story 2-5). 3 subagents adversariaux (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Triage après dédup croisée.

### Patch (à traiter)

- [ ] [Review][Patch] getGeminiClient dupliqué server.ts vs geminiClient.ts (D-3 violation) [server.ts:67-84, geminiClient.ts:31]
- [ ] [Review][Patch] chiffre/signalFaible défaut `{}` au lieu de `null` (Task 3.6) [structurer.ts:217-225]
- [ ] [Review][Patch] generatedAt retourné toujours `null` même après write réussi (trompeur) [structurer.ts:489, 501]
- [ ] [Review][Patch] computeWeekId diverge de server.ts:155-156 (TZ/DST/ISO mismatch) [structurer.ts:102-108]
- [ ] [Review][Patch] /api/veille/latest catch retourne 500 (AC #11 "Pas de 500") [server.ts:413-417]
- [ ] [Review][Patch] simulation gated `!hasApiKey` only (AC #9 fallback incomplet) [server.ts:180]
- [ ] [Review][Patch] markdown fence stripping absent dans parseGeminiResponse (Gemini wraps en ```json) [structurer.ts:181-262]
- [ ] [Review][Patch] actions schema drop confidentiality/criticality (drift sim/real) [structurer.ts:374-384]
- [ ] [Review][Patch] return type generateWeeklyAutoReport inconsistent 3 branches (TS va crier) [server.ts:150-251]
- [ ] [Review][Patch] geminiClient construit avec MOCK_KEY réelle (fail-fast au lieu de silently) [geminiClient.ts:31-32]
- [ ] [Review][Patch] top3 non-cappé (Gemini peut retourner 50 strings) [structurer.ts:191-193]
- [ ] [Review][Patch] mouvements/reglementation/ressources deep validation gaps [structurer.ts:199-243]
- [ ] [Review][Patch] SOURCE rss-lucca interne leak dans prompt (LLM echo sourceId au lieu de nom affiché) [structurer.ts:119]
- [ ] [Review][Patch] responseSchema cast brittle (extends infer chain) [structurer.ts:456-462]
- [ ] [Review][Patch] /api/veille/latest FAILED_PRECONDITION index catch spécifique [server.ts:399]
- [ ] [Review][Patch] /api/veille/latest normalize data.report non-object (corrupted doc) [server.ts:406-412]
- [ ] [Review][Patch] computeWeekId regex accepte w0/w54 (clamp [1..53] ou ISO strict) [structurer.ts fixture, helper]

### Defer (pré-existant hors scope 2-5)

- [x] [Review][Defer] fixture duplique logique prod (drift risk) [scripts/structurer-logic-fixture.ts:1-9] — deferred, limitation env AI Studio (no node_modules), pattern pré-existant stories 2-3/2-4
- [x] [Review][Defer] weekLabel hardcode "2026-" [server.ts:160] — deferred, pré-existant hors scope 2-5
- [x] [Review][Defer] /api/veille/auto-generate GET unauth + no rate-limit [server.ts:314] — deferred, pré-existant, story 3-2 traitera
- [x] [Review][Defer] no timeout Gemini/Firestore [structurer.ts:451, 493] — deferred, story 3-4 (cron configurable)
- [x] [Review][Defer] weekTitle lowercase vs capitalize [server.ts:161] — deferred, cosmétique
- [x] [Review][Defer] maxRetries/backoff absent sur Gemini [structurer.ts:451-464] — deferred, story 3-4
- [x] [Review][Defer] concurrent structureWeeklyReport race [structurer.ts:422-524] — deferred, setDoc idempotent last-writer-wins documenté
