---
baseline_commit: 5ba9280
---

# Story 3.4 : Cron hebdo configurable et migration des rapports existants

Status: backlog

## Story

**User Story** (depuis `epics.md` ligne 227) : En tant qu'admin, je veux que le cron de scan soit configurable par source (daily / weekly / custom CRON) et que les rapports legacy (avant Epic 3) soient migrés au nouveau format, afin d'avoir une base de données propre.

**Capability source** : CAP-2 (spec v1.1) — Fréquence de scan configurable
**Valeur métier** : Aujourd'hui le cron est hardcodé dimanche 23:30 (story 2-1). Les sources `daily` ou `custom` ne sont pas respectées. La migration des rapports legacy évite d'avoir des données dans 2 formats différents.

**Dépendances** : 3.1, 3.2, 3.3 done (Epic 3 stories précédentes). Le `VeilleSource` a déjà un champ `scanFrequency` (cf. firestore.rules validation), mais le scanner worker ne le lit pas encore.

## Acceptance Criteria (BDD-ready)

1. **Champ `scanFrequency` déjà dans `VeilleSource`** — Confirmé par firestore.rules:79-80 (enum `"daily" | "weekly" | "custom"`). Le scanner worker `scanner.ts:scanAllActiveSources` doit lire ce champ et scheduler différemment.

2. **Logique de scheduling par source** — Pour chaque `VeilleSource.active === true` :
   - `scanFrequency: "weekly"` → scanner le dimanche entre 23h00 et 23h59 (comportement actuel, single pass)
   - `scanFrequency: "daily"` → scanner tous les jours entre 02h00 et 02h59 (décaler pour ne pas collisionner avec weekly dimanche)
   - `scanFrequency: "custom"` + `cronExpression: string` → utiliser `node-cron` pour scheduler cette source à l'expression fournie (validée au préalable, 5 fields max)
   - Helper pur `shouldRunSourceNow(source, now: Date): boolean` (testable)

3. **Refacto `scanner.ts`** — Extraire la boucle principale dans une fonction pure `selectSourcesToRun(sources: VeilleSource[], now: Date): VeilleSource[]`. Le cron `node-cron` global reste (tick toutes les minutes) mais ne déclenche le scan QUE pour les sources dont `shouldRunSourceNow === true`.

4. **Validation `cronExpression`** — Si `scanFrequency === "custom"` et `cronExpression` invalide, la source est marquée `active: false` avec `lastError: "invalid_cron"` loggé warn. L'admin doit corriger via l'UI admin. Validation : regex `^(\S+\s+){4}\S+$` (5 fields séparés par whitespace, basique) + tentative de `node-cron` validation en mode dry-run.

5. **Migration des rapports legacy** — Script `scripts/migrate-legacy-reports.ts` (one-shot, run manuel) qui :
   - Lit tous les docs `reports/*` (Admin SDK)
   - Pour chaque doc, vérifie `actualites.length` : si 7 (legacy Gemini) → transformer en 5 (top 5 par score) + renommer champ si nécessaire
   - Backup avant modif : copie dans `reports/_legacy_backup/{id}` (sous-collection, Admin SDK only)
   - Idempotent : si `_legacy_backup/{id}` existe, skip
   - Dry-run mode (`--dry-run` flag) : log les changements sans écrire
   - Cible : 0 erreur sur les rapports existants, idempotence vérifiée

6. **Endpoint admin `POST /api/veille/admin/migrate-legacy`** (alternative au script) — Même logique, callable via UI admin. Auth Bearer. Réponse JSON avec le diff (combien de rapports modifiés, combien skippés). Log audit `reason: "legacy_migration"` dans `veille_audit_log/`.

7. **Documentation update** — `CLAUDE.md` section "Architecture" : mentionner que le scanner est maintenant per-source configurable. `_bmad-output/specs/spec-veille-automatique/SPEC.md` : pas de modif (la spec CAP-2 est déjà cadrée correctement).

8. **Tests purs** — `scripts/cron-config-fixture.ts` valide :
   - `shouldRunSourceNow(source, mockDate)` — 8 cas (weekly dimanche 23h30 = true ; weekly lundi = false ; daily 02h30 = true ; daily 14h00 = false ; custom CRON match = true ; custom CRON no match = false ; custom CRON invalide = false ; inactif = false)
   - `validateCronExpression("*/5 * * * *")` → true / `"invalid"` → false — 6 cas valides + 4 cas invalides
   - `selectSourcesToRun(sources, now)` filtre correctement — 5 cas
   - Migration legacy : rapport 7 actualités → 5 (top 5) — 4 cas
   Cible : **27/27 tests OK**.

9. **Aucune dépendance nouvelle** — `node-cron` (déjà installé). Pour le dry-run validation CRON : pattern d'expression régulière (pas de lib `cron-parser` pour éviter une nouvelle dep).

10. **Backward compat** — Si le script de migration est lancé sur une base vide (pas de legacy), il exit 0 sans erreur. Les sources avec `scanFrequency` invalide (pas dans l'enum) sont skip avec warn.

## Tasks / Subtasks

- [ ] **Task 1 — Helpers `shouldRunSourceNow` + `validateCronExpression` + tests** (AC: #2, #4, #8)
  - [ ] 1.1: Créer `scripts/cron-config-fixture.ts` (squelette + 27 cas)
  - [ ] 1.2: Implémenter dans `src/server/veille/scheduler.ts` (nouveau fichier)
  - [ ] 1.3: Run fixture → 27/27 OK
- [ ] **Task 2 — Refacto `scanner.ts`** (AC: #1, #3)
  - [ ] 2.1: Extraire `selectSourcesToRun(sources, now)` pure function
  - [ ] 2.2: Tick cron global reste, mais scan per-source conditionnel
  - [ ] 2.3: Vérifier que le scan dimanche soir fonctionne toujours
- [ ] **Task 3 — Script migration legacy** (AC: #5)
  - [ ] 3.1: Créer `scripts/migrate-legacy-reports.ts`
  - [ ] 3.2: Mode `--dry-run` + mode effectif + idempotence
  - [ ] 3.3: Documentation dans le header du fichier
- [ ] **Task 4 — Endpoint admin migration (optionnel)** (AC: #6)
  - [ ] 4.1: Si temps disponible, ajouter `POST /api/veille/admin/migrate-legacy` (sinon skip, l'admin utilise le script)
  - [ ] 4.2: Wire audit log entry `reason: "legacy_migration"`
- [ ] **Task 5 — Documentation update + smoke** (AC: #7, #9, #10)
  - [ ] 5.1: Update `CLAUDE.md` section Architecture
  - [ ] 5.2: `npm run lint` → 0 erreur
  - [ ] 5.3: Run migration script en dry-run sur la base actuelle → log attendu

## Definition of Done

- [ ] Tous AC validés (27/27 tests fixture OK)
- [ ] `npm run lint` passe
- [ ] Cron hebdo toujours fonctionnel (vérifier dimanche suivant ou via test)
- [ ] Cron daily opérationnel (vérifier en activant une source daily)
- [ ] Cron custom opérationnel (vérifier avec une CRON expression valide)
- [ ] Migration script testé en dry-run (0 erreur sur base vide)
- [ ] Documentation à jour
- [ ] Code review : 0 finding critique
- [ ] Commit sur `main`
- [ ] **Epic 3 retrospective** : à compléter après cette story
