# Acceptance Auditor — Review prompt

**Objectif :** Vérifier que l'implémentation story 1.1 satisfait les acceptance criteria.

**Output :** Liste Markdown de findings. Chaque finding : titre, AC violé, evidence du diff.

**AC à vérifier (depuis story file) :**

1. **Schéma TypeScript exporté** — `src/types/veille.ts` exporte interface `VeilleSource` avec : id, name, url, type (rss/sitemap/api), apiKeyEnvVar?, keywords[], categories[], active, lastScanAt Timestamp|null, scanFrequency (daily/weekly/custom), cronExpression?, reliabilityScore 0-100.

2. **Pré-remplissage idempotent** — `src/lib/veilleSeed.ts` insère 9 sources primaires depuis `sources-donnees.md` avec `active: true` et reliabilityScore selon "Fiabilité" (Élevée=85, Moyenne=70). RH Info ADP = "Moyenne" → 70 ; les autres = "Élevée" → 85.

3. **Règles Firestore restrictives** — `firestore.rules` ajoute `match /veille_sources/{sourceId}` : read=isSignedIn, write=isAdminEmail (christof.thomas@gmail.com ou email matche ".*admin.*"). Validation `isValidVeilleSource` (taille id ≤ 128, regex id, type enum, reliabilityScore 0-100, keywords/categories listes).

4. **Hook React de souscription** — `src/hooks/useVeilleSources.ts` expose `{ sources, loading, error, upsert, toggle, remove }` basé sur `onSnapshot(collection(db, 'veille_sources'))` avec cache `localStorage` clé `prisme_veille_sources`.

5. **Debounce + offline-first** — Mutations via debounce 1.2s + localStorage d'abord + Firestore ensuite. Échec Firestore → valeur locale persiste + retry au prochain chargement.

6. **Index Firestore composite** — `firestore.indexes.json` (ou commentaire rules) liste index `(active ASC, scanFrequency ASC)`.

**Diff complet à analyser :** voir les 5 fichiers listés dans `review-1-1-blind-hunter-prompt.md`.

**Trouve :** AC non satisfaits, implémentation partielle, comportement manquant, contradiction entre spec et code.
