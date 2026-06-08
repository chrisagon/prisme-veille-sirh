---
baseline_commit: 5ba9280
---

# Story 3.1 : Endpoint API de récupération du rapport hebdomadaire

Status: ready-for-dev

## Story

**User Story** (depuis `epics.md` ligne 224) : En tant qu'application PRISME, je veux récupérer le rapport hebdomadaire structuré depuis Firestore via une API, afin de l'afficher dans l'UI sans dépendre du mode simulation.

**Capability source** : CAP-6 (spec v1.1) — Intégration avec le flux de rapport existant
**Valeur métier** : Ferme la boucle pipeline → persistance → API → UI. Sans cet endpoint, le pipeline tourne en arrière-plan mais aucun consommateur ne peut récupérer le rapport. C'est la première brique de l'Epic 3.

**Dépendances** : Stories 2-5/2-6 done (structuration + audit). Le rapport existe en Firestore `reports/{id}` (id = weekId au format `YYYY-Www`).

## Acceptance Criteria (BDD-ready)

1. **Endpoint `GET /api/rapport/[week]`** — Route Express paramétrée par `weekId`. Réponse JSON :
   - **200** `{ status: "ok", report: VeilleReport, fetchedAt: string ISO }` si rapport trouvé
   - **404** `{ status: "not_found" }` si aucun rapport pour ce `weekId`
   - **400** `{ status: "bad_request" }` si `weekId` n'est pas au format `YYYY-Www` (regex `^\d{4}-W\d{1,2}$`)
   - **500** `{ status: "internal_error" }` si Firestore jette (uniquement erreurs non-Firestore)
   - Mode dégradé Firestore indispo (codes `unavailable`/`deadline-exceeded`) → **200** `{ status: "firestore_unavailable", report: null }` (jamais 500, le client fallback sur simulation)

2. **Auth** — Endpoint public (pas de gate admin). Le rapport est public pour tous les utilisateurs connectés. **Pas d'auth check** : on s'appuie sur les Firestore rules pour `reports/{id}` (`allow read, write: if isSignedIn()` cf. `firestore.rules:99`). Côté serveur (Admin SDK), on bypass — c'est un read public. Le client filtera via ses rules.

3. **Format `weekId`** — Le rapport est stocké sous `reports/{weekId}` où `weekId` = ISO week notation. Helper pur `parseWeekId(weekId: string): { year: number; week: number } | null` qui valide le format. Utiliser `Date.prototype.toISOString()` côté writer pour générer la clé.

4. **Helper de récupération** — Fonction `loadReportFromFirestore(weekId: string): Promise<VeilleReport | null>` dans `src/server/veille/persistence.ts` (extension de l'existant). Utilise `getDoc` (Admin SDK) sur `collection(db, "reports").doc(weekId)`. Si doc inexistant → return `null`. Si erreur Firestore → throw (le caller route handler décide du status code).

5. **Cache mémoire optionnel** — Map `Map<weekId, { report: VeilleReport; cachedAt: number }>` TTL 5 minutes. Évite de refetcher à chaque GET si l'UI poll. Invalidation au prochain `writeReport` (même fichier). Pas obligatoire, bonus de perf.

6. **Format `VeilleReport` retourné** — Doit être 100% compatible avec `src/data/defaultReports.ts`. Validation runtime : `top3` (3 strings), `actualites` (5 items, chacun avec `title`/`source`/`date`/`summary`/`url` non-vides), `mouvements`, `reglementation`, `chiffre`, `signalFaible`, `ressources`, `actions`. Si un champ manque → réponse 200 mais `report: null` avec log warn (data corrompue, ne pas 500).

7. **Logs FR** — `console.log("[rapport] GET weekId=X status=Y")` sur chaque requête. `console.warn("[rapport] Firestore indispo, fallback status=firestore_unavailable")` en mode dégradé. Pas de log du contenu du rapport (peut contenir des PII selon les sources).

8. **Aucune dépendance nouvelle** — `firebase-admin` (déjà installé). Pas de `cache-manager` ou lib externe pour le TTL in-memory (Map native).

9. **Tests purs** — `scripts/rapport-api-fixture.ts` valide :
   - `parseWeekId("2026-W23")` → `{ year: 2026, week: 23 }` — 4 cas valides
   - `parseWeekId("invalid")` → `null` — 5 cas invalides (empty, null, "2026-23", "W23", "2026-W")
   - `isValidReportShape(obj)` détecte rapport malformé (manque `actualites`, `top3` < 3, etc.) — 6 cas
   Cible : **15/15 tests OK**.

10. **Backward compat** — Les rapports legacy (avant cette story, format Gemini 7 actualités) restent lisibles via le même endpoint. Le format `actualites` peut avoir 5 ou 7 items — la validation accepte les deux. Si 5 items, l'UI affichera 5 cards au lieu de 7 (déjà géré côté App.tsx).

## Tasks / Subtasks

- [ ] **Task 1 — Helper `parseWeekId` + tests** (AC: #3, #9)
  - [ ] 1.1: Créer `scripts/rapport-api-fixture.ts` (squelette + 15 cas de test)
  - [ ] 1.2: Implémenter `parseWeekId` dans `src/server/veille/types.ts` (ou nouveau `weekId.ts` co-localisé)
  - [ ] 1.3: Run `npx tsx scripts/rapport-api-fixture.ts` → 15/15 OK
- [ ] **Task 2 — Helper `isValidReportShape` + extension `persistence.ts`** (AC: #4, #6)
  - [ ] 2.1: Implémenter `isValidReportShape` (co-localisé `parseWeekId`)
  - [ ] 2.2: Ajouter `loadReportFromFirestore(weekId)` dans `src/server/veille/persistence.ts`
  - [ ] 2.3: Ajouter cache mémoire optionnel (Map TTL 5min) + invalidation dans `writeReport`
- [ ] **Task 3 — Route handler `GET /api/rapport/[week]`** (AC: #1, #2, #7)
  - [ ] 3.1: Ajouter route dans `server.ts` (regrouper avec les autres `/api/veille/*` et `/api/rapport/*`)
  - [ ] 3.2: Wire try/catch avec mapping d'erreurs Firestore → 200 firestore_unavailable / 500 internal_error
  - [ ] 3.3: Logger `[rapport] GET weekId=X status=Y` sur chaque réponse
- [ ] **Task 4 — Type-check + smoke test local** (AC: tous)
  - [ ] 4.1: `npm run lint` → 0 erreur
  - [ ] 4.2: `npm run dev` puis `curl http://localhost:3000/api/rapport/2026-W23` → 200 ou 404 ou firestore_unavailable
  - [ ] 4.3: `curl http://localhost:3000/api/rapport/invalid` → 400

## Definition of Done

- [ ] Tous les AC validés (15/15 tests fixture OK)
- [ ] `npm run lint` passe (0 erreur)
- [ ] Route testée localement (3 cas : valide, invalide, Firestore indispo)
- [ ] Pas de secret leaké (pas de log du contenu)
- [ ] Code review (subagent) : 0 finding critique
- [ ] Commit sur `main` avec message conventionnel (`feat(api):` ou `feat(rapport):`)
