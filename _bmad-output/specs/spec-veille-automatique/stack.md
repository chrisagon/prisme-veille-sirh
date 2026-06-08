# Stack Technique — Pipeline de Veille

_Choix techniques pour l'implémentation du backend de veille automatique._

---

## Parsing RSS / XML

- **`fast-xml-parser`** — parsing RSS/Atom robuste, léger, TypeScript-friendly.
- Alternative : **`rss-parser`** (moins active, mais plus simple).
- **Règle** : privilégier `fast-xml-parser` pour la flexibilité sur les formats RSS variants.

## Crawl / Fetch

- **`node-fetch`** (déjà dans Node 18+) ou **`undici`** — pour les requêtes HTTP.
- **Timeout stricte** : 3500ms par requête (pattern existant dans `server.ts`).
- **User-Agent** : `PRISME-Bot/1.0` (pattern existant).
- **Rate limiting** : 1 req/sec max par domaine pour ne pas être banni.

## Extraction de contenu article

- **`@mozilla/readability`** ou équivalent — extracteur de contenu principal depuis HTML brut.
- Alternative légère : **`article-parser`** (Open Graph + contenu textuel).
- **Règle** : si la source est RSS, utiliser le `<description>`/`content:encoded` directement. Si sitemap, parser l'article avec `readability`.

## Scoring de pertinence

- **TF-IDF maison** ou **`natural`** (NLP lib Node.js) — calcul de densité de mots-clés.
- **Mots-clés SIRH/IA** : liste maintenue en config ("SIRH", "IA", "intelligence artificielle", "recrutement", "paie", "GPEC", "ATS", "IA Act", "CNIL", "RGPD", etc.).
- **Scoring composite** :
  ```
  score = (keywordDensity * 40) + (sourceReliability * 30) + (recency * 20) + (antiPromo * 10)
  ```

## Anti-promotionnel

- Liste noire de marqueurs linguistiques : "nous proposons", "contactez-nous", "demandez une démo", "solution clé en main", "gratuit", "offre limitée".
- Présence d'un CTA button/formulaire dans le HTML → flag promotionnel.

## Résumé / Classification

- **Google Gemini (`gemini-3.5-flash`)** — résumé 2 lignes, classification dans les 5 catégories.
- **Prompt contraint** : le modèle reçoit UNIQUEMENT le texte extrait + mots-clés. Il ne doit PAS inventer d'infos.
- **Schéma JSON strict** en sortie, identique au `VeilleReport` existant.

## Stockage temporaire

- **Firestore** : collection `veille_raw_articles` pour les articles extraits avant scoring.
- **TTL** : articles bruts supprimés après 7 jours.

## Ordonnancement

- **`node-cron`** (déjà installé) — scan hebdomadaire configuré par l'admin.
- **Trigger manuel** : bouton admin "Forcer le scan" dans l'UI.

## Dépendances à ajouter

```json
{
  "fast-xml-parser": "^4.x",
  "@mozilla/readability": "^0.x",
  "natural": "^7.x"
}
```

## Dépendances existantes réutilisées

- `@google/genai` — classification + résumé
- `node-cron` — scheduling
- `firebase` / `firebase-admin` — stockage (si besoin d'écriture serveur)
- `express` — endpoints API
