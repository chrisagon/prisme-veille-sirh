# Deferred Work

## Deferred from: code review of 1-1-modele-de-donnees-veillesource-et-collection-fires (2026-06-03)

- DARES source : type "api" déclaré dans `veilleSeed.ts` mais URL = page HTML `https://dares.travail-emploi.gouv.fr/` sans `apiKeyEnvVar` ni endpoint API documenté. Soit changer type en "sitemap", soit trouver le vrai endpoint API REST. Source : spec `_bmad-output/specs/spec-veille-automatique/sources-donnees.md` ligne 21. À traiter dans une story future dédiée "Curation catalogue sources" (hors scope story 1.1).

## Deferred from: code review of 1-2-ui-admin-de-gestion-des-sources (2026-06-03)

- **Admin gate substring `"admin"` dupliqué + non durci** — `App.tsx:522-527` et `App.tsx:632-635` font `email.toLowerCase().includes("admin")`, ce qui accepte `attacker-admin@evil.com`. Dette de sécurité préexistante. À traiter : extraire `isAdminEmail()` dans `src/lib/auth.ts`, l'utiliser aux deux endroits + dans `firestore.rules` (`isAdminEmail()` côté rules). Backlog epic-2+.
- **`useVeilleSources` retourne nouvel objet à chaque render** → re-render des consumers. `useVeilleSources.ts:174`. Impact réel négligeable pour 9 sources primaires. À traiter si le catalog dépasse ~50 sources. Backlog perf.
- **Card stack mobile non implémenté** — Dev note #112 de la story 1.2 mentionne "version card stack < 768px (à prioriser pour MVP)". Seul `overflow-x-auto` est implémenté. Backlog epic-2 polish.

## Deferred from: code review of 2-3-scoring-de-pertinence-composite (2026-06-04)

- **F09 Mutex cache / TTL dans `sourceReliabilityCache.ts:31-55`** — Pas de cache module-level, ni de mutex concurrent. Si `loadReliabilityMap` est appelée 2× en parallèle → 2 lectures Firestore. Pour scope actuel (≤ 50 sources, scan quotidien) non-problème. Le caller (story 2-4) devra porter le cache/TTL. JSDoc actuel dit "le caller est responsable du TTL" — à implémenter concrètement dans l'orchestrateur.
- **F13 Caractères pré-composés `œ/æ/ø` non décomposés par NFD dans `keywords.ts:59-65`** — `String.normalize("NFD")` ne décompose pas les caractères pré-composés. Si un futur mot-clé contient "cœur" ou "œuvre", il ne matchera pas la version ASCII "coeur"/"oeuvre". Aucun mot-clé actuel concerné (tous ASCII après NFD). À traiter si ajout futur.
- **F24 Pas de pagination Firestore (10k+ sources) dans `sourceReliabilityCache.ts:39`** — `getDocs` sans `limit()` ni cursor. Scope actuel ≤ 50 sources, non-problème. Future-proofing si le catalog dépasse 1k sources. Backlog perf.

## Deferred from: code review of 2-5-structuration-en-5-categories-metier-gemini (2026-06-05)

- **Fixture duplique logique prod** — `scripts/structurer-logic-fixture.ts:1-9` admet dans son propre header dupliquer `computeWeekId`, `buildStructurationPrompt`, `parseGeminiResponse`, `validateActualitesCount`. Limitation env AI Studio (no `node_modules`) qui empêche `import` direct. Pattern pré-existant stories 2-3/2-4. Fix futur : `npm install` puis refactor fixture → tests réels via import.
- **`weekLabel` hardcode préfixe `2026-`** — `server.ts:160`. En 2027+ le cron étiquettera toujours `2026-wN`. Pré-existant hors scope story 2-5. Fix : `date.getFullYear()`.
- **`/api/veille/auto-generate` GET + unauth + no rate-limit** — `server.ts:314`. (a) `GET` autorise prefetch/browser/curl accidentel → vector d'amplification de coût Gemini. (b) Pas de `checkAdminAuth` contrairement à `POST /api/veille/admin/purge-expired`. Pré-existant, story 3-2 (déclenchement manuel admin) traitera.
- **Pas de timeout sur appel Gemini / écriture Firestore** — `structurer.ts:451, 493`. Un hang peut bloquer le cron. Pré-existant pattern, à traiter story 3-4 (cron configurable) avec `AbortSignal.timeout()`.
- **`weekTitle` lowercase vs capitalize** — `server.ts:161`. `now.toLocaleString('fr-FR', { month: 'long' })` produit "juin" minuscule. `defaultReports.ts` capitalise ("Juin"). Cosmétique, hors scope.
- **Pas de `maxRetries`/backoff sur appel Gemini** — `structurer.ts:451-464`. Un 503 transient retourne `null` et déclenche fallback simulation. Le caller ne peut pas distinguer transient de permanent. À traiter story 3-4 avec retry sur 5xx et `reason` field.
- **Race condition `structureWeeklyReport` concurrente même `weekId`** — `structurer.ts:422-524`. `setDoc` idempotent, last-writer-wins. `batchId` peut diverger du doc persisté. Documenté dans le service.
