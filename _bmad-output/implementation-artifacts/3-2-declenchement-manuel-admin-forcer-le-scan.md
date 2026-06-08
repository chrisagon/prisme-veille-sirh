---
baseline_commit: 5ba9280
---

# Story 3.2 : Déclenchement manuel admin "Forcer le scan"

Status: backlog

## Story

**User Story** (depuis `epics.md` ligne 225) : En tant qu'admin, je veux pouvoir déclencher manuellement un scan de veille depuis l'UI, afin de générer un rapport à la demande sans attendre le cron dimanche soir.

**Capability source** : CAP-1/CAP-2 (spec v1.1) — Scan déclenchable on-demand
**Valeur métier** : Permet de tester le pipeline en dev/staging sans attendre J+1 du cron. Permet aussi de regénérer un rapport après un échec de scan hebdomadaire. Critique pour debug + réactivité.

**Dépendances** : 2-1 done (scanner worker). 2-6 done (audit log écrit pendant le scan). 3.1 n'est PAS requis techniquement (le rapport est écrit en Firestore par le pipeline, pas via 3.1).

## Acceptance Criteria (BDD-ready)

1. **Endpoint `POST /api/veille/force-scan`** — Route Express avec auth admin Bearer token (pattern story 2-4, via `checkAdminAuth`). Réponse JSON :
   - **200** `{ status: "started", weekId: string, scanId: string }` si scan déclenché
   - **401** `{ status: "unauthorized" }` si pas de Bearer ou Bearer invalide
   - **429** rate-limited si > 5 requêtes / minute (cf. `llmLimiter` déjà en place)
   - **503** `{ status: "firestore_unavailable" }` si Admin SDK init impossible

2. **Scan async (fire-and-forget)** — L'endpoint répond 200 immédiatement, le scan tourne en background. Le `scanId` retourné permet de poll le statut via `GET /api/veille/scan-status/[scanId]`. Pas d'attente côté client (timeout Cloud Run = 300s max).

3. **Lock anti-double-trigger** — Si un scan est déjà en cours pour le même `weekId`, retourner 200 `{ status: "already_running", existingScanId: string }` au lieu de démarrer un second scan. Lock implémenté via Map `Map<weekId, scanId>` in-memory + `lastHeartbeat` (cleanup > 10min stale).

4. **Wire scanner** — Réutiliser `scanner.scanAllActiveSources(weekId)` (déjà exposé par story 2-1). Le `force-scan` invoque cette fonction avec le `weekId` courant (= ISO week du lundi). Skip si dimanche 23h30-23h59 (le cron va tourner, pas besoin de doubler).

5. **Scan status tracking** — Collection Firestore `veille_scan_runs/{scanId}` (Admin SDK only). Champs : `scanId`, `weekId`, `startedAt`, `finishedAt?`, `status: "running" | "success" | "failed"`, `articlesScanned`, `articlesKept`, `errorMessage?`. TTL 7 jours.

6. **Endpoint `GET /api/veille/scan-status/[scanId]`** — Lecture seule, auth admin. Réponse 200 avec le doc Firestore ou 404 si `scanId` inconnu. Pas de rate-limit (lecture peu coûteuse).

7. **UI bouton "Forcer le scan"** — Dans `src/App.tsx`, section admin, **uniquement visible si `isAdmin()`**. État local : `isScanning: boolean`, `lastScanResult: { scanId, status } | null`. Bouton disabled pendant scan. Affichage résultat (succès/échec) après réponse. **Pas de polling auto** : l'admin clique pour refresh le statut.

8. **Logs FR** — `console.log("[force-scan] déclenché par user=X weekId=Y scanId=Z")` au start. `console.log("[force-scan] terminé status=X durée=Yms")` à la fin. Logger via `auditor.ts` (story 2-6) les rejets générés pendant le scan (déjà wired).

9. **Tests purs** — `scripts/force-scan-fixture.ts` valide :
   - `getCurrentWeekId()` retourne le bon ISO week pour une date donnée — 5 cas (lundi, dimanche, fin d'année, début d'année, DST)
   - `isSundayLateAfternoon(date)` → boolean (entre 23h00 et 23h59) — 4 cas
   - `isStaleLock(heartbeat)` → boolean (heartbeat > 10min) — 3 cas
   Cible : **12/12 tests OK**.

10. **Aucune dépendance nouvelle** — `firebase-admin` + `node-cron` (déjà installés). Le lock in-memory est natif (Map).

## Tasks / Subtasks

- [ ] **Task 1 — Helpers `getCurrentWeekId` + `isSundayLateAfternoon` + tests** (AC: #9)
  - [ ] 1.1: Créer `scripts/force-scan-fixture.ts` (squelette + 12 cas)
  - [ ] 1.2: Helpers dans `src/server/veille/weekId.ts` (co-localisé avec story 3-1)
  - [ ] 1.3: Run fixture → 12/12 OK
- [ ] **Task 2 — Lock in-memory + scan-status Firestore** (AC: #3, #5)
  - [ ] 2.1: Créer `src/server/veille/scanLock.ts` (Map<weekId, {scanId, lastHeartbeat}>)
  - [ ] 2.2: Helper `createScanRun(weekId)` → écrit doc `veille_scan_runs/{scanId}` via Admin SDK
  - [ ] 2.3: Helper `updateScanRun(scanId, partial)` pour heartbeat + status final
- [ ] **Task 3 — Routes `POST /api/veille/force-scan` + `GET /api/veille/scan-status/[scanId]`** (AC: #1, #2, #6)
  - [ ] 3.1: Wire `llmLimiter` + `checkAdminAuth` middleware
  - [ ] 3.2: Handler async fire-and-forget : retourne 200 immédiatement, scan en background
  - [ ] 3.3: Route GET pour lire le statut
- [ ] **Task 4 — UI bouton "Forcer le scan"** (AC: #7)
  - [ ] 4.1: Section admin dans `App.tsx` (chercher pattern existant `isAdmin`)
  - [ ] 4.2: Bouton + état `isScanning` + affichage résultat
  - [ ] 4.3: Hook `useEffect` qui check `VEILLE_ADMIN_TOKEN` présence (désactive bouton si absent)
- [ ] **Task 5 — Type-check + smoke test** (AC: tous)
  - [ ] 5.1: `npm run lint` → 0 erreur
  - [ ] 5.2: `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/veille/force-scan` → 200
  - [ ] 5.3: `curl -X POST http://localhost:3000/api/veille/force-scan` (sans token) → 401

## Definition of Done

- [ ] Tous AC validés (12/12 tests fixture OK)
- [ ] `npm run lint` passe
- [ ] Endpoints testés localement (3 cas : avec token, sans token, double-trigger)
- [ ] UI testée manuellement (admin voit le bouton, scan démarre, statut visible)
- [ ] Pas de regression sur le cron dimanche 23h30 (toujours actif)
- [ ] Code review : 0 finding critique
- [ ] Commit sur `main`
