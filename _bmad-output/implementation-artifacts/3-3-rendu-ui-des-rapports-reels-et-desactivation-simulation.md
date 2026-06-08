---
baseline_commit: 5ba9280
---

# Story 3.3 : Rendu UI des rapports réels et désactivation simulation

Status: backlog

## Story

**User Story** (depuis `epics.md` ligne 226) : En tant qu'utilisateur PRISME, je veux voir les rapports générés par le pipeline réel (pas la simulation), afin de consulter la veille SIRH/IA authentique de la semaine.

**Capability source** : CAP-6 (spec v1.1) — Intégration avec le flux de rapport existant
**Valeur métier** : Sans cette story, l'utilisateur voit toujours des rapports pré-câblés (simulation Gemini legacy). Le pipeline tourne en arrière-plan mais n'atteint pas l'UI. Story critique pour fermer la spec.

**Dépendances** : 3.1 done (endpoint API), 3.2 done (force-scan pour générer un rapport testable en dev). Le client Firestore SDK lit `reports/{id}` mais l'UI utilise actuellement les `defaultReports` hardcodés en fallback.

## Acceptance Criteria (BDD-ready)

1. **Sélecteur de semaine consomme l'API réelle** — `src/App.tsx` : lors du changement de semaine dans le picker, **d'abord** appeler `GET /api/rapport/[week]` (3.1). Si 200 + report non-null → remplacer le rapport affiché. Si 404 → fallback sur `defaultReports` (comportement actuel). Si `firestore_unavailable` → fallback sur `defaultReports` + toast "Rapport réel temporairement indispo, affichage simulation".

2. **Cache localStorage** — Mémoriser le dernier `weekId → report` pour éviter le re-fetch à chaque mount. Cache key : `prisme:report:${weekId}`. TTL : session (pas de `expiresAt` complexe, juste check `localStorage.removeItem` à la fin de session). Invalidation : bouton "Rafraîchir" (déjà présent ou à ajouter) → force re-fetch + clear cache.

3. **Indicateur "rapport réel"** — Badge visuel (icône check + texte "Rapport réel") à côté du titre du rapport quand le rapport vient de l'API. Badge "Simulation" si fallback `defaultReports`. Permet à l'utilisateur de savoir ce qu'il regarde.

4. **Désactivation simulation si `OPENROUTER_API_KEY` présent** — Si le serveur répond `{ status: "firestore_unavailable" }` ET `import.meta.env` (ou runtime check) détecte `OPENROUTER_API_KEY` set → **ne PAS fallback sur simulation**, montrer un message d'erreur "Le rapport réel n'a pas encore été généré pour cette semaine. Contactez l'admin." L'admin peut alors utiliser le bouton "Forcer le scan" (3.2) pour générer.

5. **Loading state** — Pendant le fetch API : skeleton UI ou spinner. Pas de layout shift. Le rapport précédent reste affiché en attendant.

6. **Error boundary** — Si l'API retourne 500 (improbable mais possible), fallback gracieux sur simulation + toast d'erreur. Pas de crash UI.

7. **Bouton "Forcer le scan" admin (déjà codé 3.2)** — Visible uniquement si `isAdmin()`. Pendant scan : bouton disabled avec texte "Scan en cours..." + spinner. Après réponse 200 : toast "Scan lancé, refresh dans 30s" + refresh auto du rapport après délai (polling soft).

8. **Migration des rapports hardcodés** — Les 4-5 rapports dans `src/data/defaultReports.ts` restent comme fallback legacy (story NG-3 : "pas de génération fantaisiste" → on garde la simulation UNIQUEMENT en cas d'indispo réelle). Marquer chaque rapport fallback avec `simulated: true` dans ses metadata (déjà fait, vérifier).

9. **Logs FR** — `console.log("[App] rapport chargé weekId=X source=real|simulation")` côté client. Permet de tracer en dev tools quel rapport est affiché.

10. **Tests** — Pas de test framework installé. **Test manuel** documenté dans une checkliste :
    - [ ] Mount → fallback sur `defaultReports` (avant 1er scan)
    - [ ] Force-scan admin → après 30s, refresh → badge "Rapport réel"
    - [ ] Refresh page → rapport réel servi depuis cache localStorage
    - [ ] Firestore indispo (kill le service) → fallback simulation + toast
    - [ ] `OPENROUTER_API_KEY` set + Firestore indispo → message d'erreur, PAS de fallback

11. **Aucune dépendance nouvelle** — `react` (déjà installé). Pas de `swr` ou `react-query` (overkill). Fetch natif `fetch()` ou helper existant.

## Tasks / Subtasks

- [ ] **Task 1 — Hook `useWeeklyReport(weekId)`** (AC: #1, #2, #5, #6)
  - [ ] 1.1: Créer `src/hooks/useWeeklyReport.ts` (co-localisé dans src/hooks/, nouveau dossier)
  - [ ] 1.2: Fetch `GET /api/rapport/${weekId}` + cache localStorage
  - [ ] 1.3: Return `{ report, isLoading, source: "real" | "simulation" | null, error }`
- [ ] **Task 2 — Intégration dans `App.tsx`** (AC: #1, #3, #5)
  - [ ] 2.1: Remplacer lecture directe `defaultReports` par `useWeeklyReport(weekId)` dans le composant principal
  - [ ] 2.2: Ajouter badge visuel "Rapport réel" / "Simulation" à côté du titre
  - [ ] 2.3: Loading state avec skeleton/spinner
- [ ] **Task 3 — Désactivation simulation conditionnelle** (AC: #4)
  - [ ] 3.1: Helper `shouldFallbackToSimulation(error, hasOpenRouterKey)` co-localisé
  - [ ] 3.2: Brancher dans `useWeeklyReport` : si condition remplie → throw / error state
  - [ ] 3.3: UI message d'erreur spécifique
- [ ] **Task 4 — Wire bouton "Forcer le scan"** (AC: #7)
  - [ ] 4.1: Le bouton (codé 3.2) appelle `useWeeklyReport` après scan pour refresh
  - [ ] 4.2: Toast + setTimeout 30s pour re-fetch
- [ ] **Task 5 — Test manuel checkliste + smoke** (AC: #10)
  - [ ] 5.1: Exécuter checklist 5 cas
  - [ ] 5.2: `npm run lint` → 0 erreur
  - [ ] 5.3: `npm run build` → build OK

## Definition of Done

- [ ] Tous AC validés (10/10 cas manuels OK)
- [ ] `npm run lint` + `npm run build` passent
- [ ] UI testée manuellement avec les 5 cas
- [ ] Pas de regression : utilisateurs existants voient toujours un rapport (réel ou simulation fallback)
- [ ] Badge visuel visible et correct dans tous les cas
- [ ] Code review : 0 finding critique
- [ ] Commit sur `main`
