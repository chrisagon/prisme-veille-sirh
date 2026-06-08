# Edge Case Hunter — Review prompt

**Objectif :** Trouver edge cases et scénarios limites dans le diff de la story 1.1.

**Output :** Liste Markdown de findings avec Sévérité + description + suggestion.

**Contexte projet (lecture seule) :**
- `src/App.tsx` (lignes 376-525 : useEffect d'auth, lignes 619-625 : isAdmin)
- `src/lib/firebase.ts` (handleFirestoreError ligne 79)
- `src/data/defaultReports.ts` (VeilleReport interface)
- `firestore.rules` (helpers existants)
- `package.json` (firebase@12.13.0, react@19)
- Story file : `_bmad-output/implementation-artifacts/1-1-modele-de-donnees-veillesource-et-collection-fires.md`

**Edge cases à cibler :**
- Race conditions entre `onSnapshot` et debounced `upsert`
- Conflits localStorage/Firestore si user modifie depuis 2 onglets
- `pendingRef` n'est pas réinitialisé sur unmount → flush à faire ?
- Snapshot error ne nettoie pas `loading` correctement
- `toggle` capture `sources` dans closure → stale state possible
- `lastScanAt: null` à l'écriture, mais `Timestamp | null` en type → cohérence
- `isValidVeilleSource` ne valide PAS la longueur de `name`, `url`, `keywords` array max
- `apiKeyEnvVar` non validé (pourrait être n'importe quoi)
- Idempotence seed : si 2 admins se connectent simultanément ?
- `useEffect` sans `loading` initial à false → loading=true jusqu'au premier snapshot
- TanStack Query-like patterns pas utilisés → re-render inutiles ?
- localStorage quota exceeded silencieux
- Firestore `count` coût 1 read par appel

**Format de sortie :** Markdown
```
## [Sévérité] Titre
- **Fichier**: path:line
- **Problème**: ...
- **Fix suggéré**: ...
```
