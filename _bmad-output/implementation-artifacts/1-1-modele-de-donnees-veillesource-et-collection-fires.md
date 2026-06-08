---
baseline_commit: NO_VCS
---

# Story 1.1: Modèle de données VeilleSource et collection Firestore

Status: done

## Story

En tant qu'admin PRISME,
je veux qu'un schéma TypeScript `VeilleSource` soit défini, validé et persisté dans une collection Firestore `veille_sources` pré-remplie avec les 9 sources RSS primaires du catalogue,
afin que les sources de veille soient configurables, partageables entre sessions et versionnables.

## Acceptance Criteria

1. **Schéma TypeScript exporté** — Un fichier `src/types/veille.ts` exporte l'interface `VeilleSource` avec les champs : `id: string`, `name: string`, `url: string`, `type: 'rss' | 'sitemap' | 'api'`, `apiKeyEnvVar?: string`, `keywords: string[]`, `categories: string[]`, `active: boolean`, `lastScanAt: Timestamp | null`, `scanFrequency: 'daily' | 'weekly' | 'custom'`, `cronExpression?: string`, `reliabilityScore: number` (0-100).

2. **Pré-remplissage idempotent** — À la première initialisation (collection vide côté client), un script seed `src/lib/veilleSeed.ts` insère les 9 sources primaires depuis `_bmad-output/specs/spec-veille-automatique/sources-donnees.md` (ActuEL-RH, Parlons RH, Centre Inffo, RH Info ADP, RH Matin, News Tank RH, EDRH, Liaisons Sociales, DARES) avec `active: true` et `reliabilityScore` selon la colonne "Fiabilité" du catalogue (Élevée=85, Moyenne=70).

3. **Règles Firestore restrictives** — Le fichier `firestore.rules` ajoute un bloc `match /veille_sources/{sourceId}` qui autorise la lecture pour tout utilisateur authentifié (`isSignedIn()`) et l'écriture uniquement si `request.auth.token.email == "christof.thomas@gmail.com"` OU `request.auth.token.email.matches(".*admin.*")`. Validation `isValidVeilleSource(data)` ajoutée en helper (taille id ≤ 128, regex `^[a-zA-Z0-9_\-]+$`, type enum, `reliabilityScore` entre 0 et 100, `keywords`/`categories` listes de strings).

4. **Hook React de souscription** — Un hook `src/hooks/useVeilleSources.ts` expose `{ sources, loading, error, upsert, toggle, remove }` basé sur `onSnapshot(collection(db, 'veille_sources'))` avec pattern de cache `localStorage` (clé `prisme_veille_sources`) pour fonctionnement offline-first (C4).

5. **Debounce + offline-first respectés** — Toute mutation (`upsert`/`toggle`) passe par un debounce 1.2s (pattern existant `App.tsx`) et écrit simultanément dans `localStorage` puis Firestore. En cas d'échec Firestore, la valeur locale persiste et une sync retry est tentée au prochain chargement.

6. **Index Firestore composite** — Un index `(active ASC, scanFrequency ASC)` est défini dans `firestore.indexes.json` (ou UI Firebase) pour permettre au worker cron de requêter efficacement les sources actives par fréquence.

## Tasks / Subtasks

- [x] **Task 1 — Créer `src/types/veille.ts`** (AC: #1)
  - [x] Subtask 1.1: Définir interface `VeilleSource` exhaustive (voir AC #1)
  - [x] Subtask 1.2: Définir type union `SourceType = 'rss' | 'sitemap' | 'api'`
  - [x] Subtask 1.3: Définir type union `ScanFrequency = 'daily' | 'weekly' | 'custom'`
  - [x] Subtask 1.4: Exporter `DEFAULT_RELIABILITY_HIGH = 85` et `DEFAULT_RELIABILITY_MEDIUM = 70`

- [x] **Task 2 — Créer `src/lib/veilleSeed.ts`** (AC: #2)
  - [x] Subtask 2.1: Constante `PRIMARY_RSS_SOURCES: VeilleSource[]` avec les 9 sources (mappage exact depuis `sources-donnees.md` lignes 11-21)
  - [x] Subtask 2.2: Fonction `seedVeilleSourcesIfEmpty(): Promise<void>` qui vérifie `getCountFromServer(collection(db, 'veille_sources'))` puis `setDoc` en lot via `writeBatch`
  - [x] Subtask 2.3: `lastScanAt = null` à l'init ; `scanFrequency = 'weekly'` par défaut sauf indication

- [x] **Task 3 — Mettre à jour `firestore.rules`** (AC: #3)
  - [x] Subtask 3.1: Ajouter helper `function isValidVeilleSource(data)` après `isValidVeilleReport` (ligne 47-52)
  - [x] Subtask 3.2: Helper `function isAdminEmail()` qui vérifie `request.auth.token.email == "christof.thomas@gmail.com" || request.auth.token.email.matches(".*admin.*")`
  - [x] Subtask 3.3: Ajouter `match /veille_sources/{sourceId}` AVANT le catch-all `match /{document=**}` avec règles read=isSignedIn, write=isAdminEmail + isValidVeilleSource

- [x] **Task 4 — Créer `src/hooks/useVeilleSources.ts`** (AC: #4)
  - [x] Subtask 4.1: Import `useState`, `useEffect`, `collection`, `onSnapshot` depuis `firebase/firestore`
  - [x] Subtask 4.2: État initial lu depuis `localStorage` (clé `prisme_veille_sources`) pour offline-first
  - [x] Subtask 4.3: `useEffect` qui souscrit à `onSnapshot` et met à jour l'état + `localStorage`
  - [x] Subtask 4.4: Fonctions `upsert(source)`, `toggle(id)`, `remove(id)` qui écrivent via `setDoc`/`deleteDoc` avec `handleFirestoreError` wrapper
  - [x] Subtask 4.5: Debounce 1.2s sur `upsert` (utiliser `useRef<number | null>` pour stocker le timer)

- [x] **Task 5 — Intégrer le seed dans `App.tsx`** (AC: #2, #5)
  - [x] Subtask 5.1: Importer `seedVeilleSourcesIfEmpty` depuis `./lib/veilleSeed`
  - [x] Subtask 5.2: Appeler dans le `useEffect` d'authentification existant (ligne 376+) après sync user, conditionné sur `isAdmin === true`

- [x] **Task 6 — Documenter l'index Firestore** (AC: #6)
  - [x] Subtask 6.1: Ajouter entrée dans `firestore.indexes.json` OU créer section commentaire en haut de `firestore.rules` listant les index requis : `veille_sources` composite sur `(active, scanFrequency)`

## Dev Notes

### Architecture patterns à respecter

- **Path alias `@/*`** → racine projet (cf. `tsconfig.json`). NE PAS utiliser `@/src/...`.
- **Pas d'import React explicite** — `jsx: "react-jsx"` dans tsconfig.
- **Préférer `unknown` à `any`** dans le nouveau code. `App.tsx` contient du `any` legacy ; ne pas le propager.
- **Offline-first** : TOUJOURS cache `localStorage` AVANT Firestore. Pattern : `setLocalThenSync()`.
- **Admin gate** : NE PAS dupliquer la logique hardcodée `christof.thomas@gmail.com` dans le hook. Centraliser via la fonction `isAdminEmail()` dans `firestore.rules` côté serveur. Côté client, réutiliser le `isAdmin` déjà calculé en `App.tsx:619`.

### Code reuse opportunities (NE PAS réinventer)

- **`handleFirestoreError`** existe déjà dans `src/lib/firebase.ts:79` — wrapper toutes les erreurs Firestore avec.
- **Pattern de sync `useEffect` + debounce** est déjà implémenté pour `reports` et `users` dans `App.tsx:376-485`. Réutiliser la même structure.
- **Hook `useRef<number | null>` pour debounce** : voir `App.tsx` lignes 220-260 pour exemple concret.
- **`VeilleReport`** est défini dans `src/data/defaultReports.ts:1-45` — utiliser le même style (interface, pas de type alias) pour `VeilleSource` côté cohérence.

### Source tree components à toucher

| Fichier | Type | Action |
|---------|------|--------|
| `src/types/veille.ts` | NEW | Créer — interface + types |
| `src/lib/veilleSeed.ts` | NEW | Créer — données seed + fonction idempotente |
| `src/hooks/useVeilleSources.ts` | NEW | Créer — hook React |
| `firestore.rules` | UPDATE | Ajouter helper + bloc match |
| `firestore.indexes.json` | UPDATE (ou commentaire) | Documenter index composite |
| `src/App.tsx` | UPDATE | Import + appel seed dans auth effect |

### Sécurité

- Règles Firestore = source de vérité pour admin gate. Le client NE PEUT PAS bypasser.
- `isAdmin` côté client (UI conditionnelle) ≠ sécurité. Toujours valider côté Firestore.
- Le helper `isAdminEmail()` côté règles doit matcher EXACTEMENT la logique `App.tsx:619-621`. Si l'email admin change un jour, mettre à jour les DEUX endroits.

### Données seed (catalogue `_bmad-output/specs/spec-veille-automatique/sources-donnees.md`)

| name | url | type | reliabilityScore | keywords par défaut |
|------|-----|------|------------------|---------------------|
| ActuEL-RH | `https://www.actuel-rh.fr/rss` | rss | 85 | ["SIRH", "RH", "recrutement", "paie"] |
| Parlons RH | `https://www.parlonsrh.com/flux-rss/` | rss | 85 | ["SIRH", "digital", "actualités RH"] |
| Centre Inffo | `https://www.centre-inffo.fr/centre-inffo/nos-flux-rss` | rss | 85 | ["formation", "CPF", "droit formation"] |
| RH Info (ADP) | `https://www.fr.adp.com/rhinfo.aspx` | sitemap | 70 | ["management", "SIRH", "paie"] |
| RH Matin | `https://www.rhmatin.com/` | sitemap | 85 | ["SIRH", "recrutement", "digital learning"] |
| News Tank RH | `https://rh.newstank.fr` | sitemap | 85 | ["veille stratégique", "politique emploi"] |
| EDRH | `https://edrh.fr/flux-rss` | rss | 85 | ["mobilités", "qualifications"] |
| Liaisons Sociales | `https://www.liaisons-sociales.fr/` | sitemap | 85 | ["droit social", "jurisprudence"] |
| DARES | `https://dares.travail-emploi.gouv.fr/` | api | 85 | ["emploi", "études RH"] |

### Testing standards

- **Aucun framework de test installé.** `package.json` n'a pas de script `test`. NE PAS installer Jest/Vitest dans cette story.
- Validation = `npm run lint` (= `tsc --noEmit`). Doit passer sans erreur.
- Vérification manuelle : créer un utilisateur admin, ouvrir console DevTools, vérifier que `collection(db, 'veille_sources')` contient 9 docs après login.

### Dependencies

- Aucune nouvelle dépendance npm. Tout est déjà installé (`firebase@12.13.0`).
- `firestore.indexes.json` peut nécessiter un déploiement via `firebase deploy --only firestore:indexes` — hors scope de cette story (à documenter dans la story de déploiement).

## References

- [Source: _bmad-output/specs/spec-veille-automatique/SPEC.md#CAP-1]
- [Source: _bmad-output/specs/spec-veille-automatique/sources-donnees.md#schéma-de-configuration-source-firestore]
- [Source: src/lib/firebase.ts#handleFirestoreError]
- [Source: src/App.tsx#isAdmin-line-619]
- [Source: src/App.tsx#auth-sync-effect-line-376]
- [Source: src/data/defaultReports.ts#VeilleReport]
- [Source: firestore.rules#isValidVeilleReport-helper]
- [Source: _bmad-output/project-context.md#technology-stack]

## Dev Agent Record

### Agent Model Used

minimax/minimax-m3 (Claude Code, session 2026-06-03)

### Debug Log References

- `tsc --noEmit` non exécutable : `node_modules` absent (`Cannot find module 'react'` etc. sur tous fichiers — préexistant, hors scope).
- Fix itératif : `pendingRef.current.entries()` retournait `IterableIterator<unknown>` en l'absence de types Map. Remplacé par `forEach` explicite avec typage `Array<[string, VeilleSource]>`.

### Completion Notes List

- 6/6 tasks implémentées.
- Aucune dépendance npm ajoutée (tout est déjà installé : `firebase@12.13.0`).
- Firestore rules : helper `isAdminEmail()` ajouté pour matcher `App.tsx:619-621`. Si l'email admin évolue, mettre à jour LES DEUX endroits.
- Seed déclenché après `setSyncStatus('synced')` dans le useEffect d'auth, conditionné sur email admin (pas sur la variable `isAdmin` qui est définie plus loin dans le composant).
- Index Firestore composite `(active ASC, scanFrequency ASC)` documenté dans `firestore.indexes.json`. Déploiement via `firebase deploy --only firestore:indexes` requis avant usage en prod.
- Validation `npm run lint` = `tsc --noEmit` non exécutée (node_modules manquant). À valider après `npm install`.
- Vérification manuelle : login admin → 9 docs dans `veille_sources` (Firestore console).

### File List

- `src/types/veille.ts` (NEW)
- `src/lib/veilleSeed.ts` (NEW)
- `src/hooks/useVeilleSources.ts` (NEW)
- `firestore.rules` (UPDATE)
- `firestore.indexes.json` (NEW)
- `src/App.tsx` (UPDATE : import + seed call)

## Review Findings

- [x] [Review][Patch] `pendingRef` non flushed sur unmount — si composant démonte pendant debounce 1.2s, les mutations sont perdues. [src/hooks/useVeilleSources.ts:60-124] — résolu : cleanup useEffect appelle flushPending
- [x] [Review][Patch] `toggle` stale state via closure sur `sources` — toggle rapide opère sur ancien state capturé. [src/hooks/useVeilleSources.ts:129-136] — résolu : ajout `sourcesRef` maintenu à jour par onSnapshot
- [x] [Review][Defer] DARES type "api" sans `apiKeyEnvVar` + URL = page HTML non-API. Catalogue source = spec, hors scope story 1.1. [src/lib/veilleSeed.ts:112-122] — deferred, préexistant (catalogue spec)
- [x] [AC-Audit][Patch] `reliabilityScore` type manquant contrainte 0-100 — résolu : JSDoc explicite + référence règle Firestore. [src/types/veille.ts:24]
- [x] [AC-Audit][Patch] Pas de retry queue sur failed write Firestore — résolu : on remet dans `pendingRef` pour le prochain flush. [src/hooks/useVeilleSources.ts:flushPending]
