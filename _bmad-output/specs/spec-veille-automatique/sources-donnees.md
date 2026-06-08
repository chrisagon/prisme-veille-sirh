# Sources de Données — Veille Automatique SIRH/IA

_Répertoire des sources configurables par l'utilisateur admin. Chaque source est scannée selon son type et ses mots-clés ciblés._

---

## Sources RSS Primaires (recommandées par défaut)

Ces sources sont pré-configurées à l'installation. L'admin peut les activer/désactiver.

| Nom | URL RSS | Type | Catégories ciblées | Fiabilité |
|-----|---------|------|-------------------|-----------|
| ActuEL-RH | `https://www.actuel-rh.fr/rss` | RSS | général, recrutement, paie, formation | Élevée |
| Parlons RH | `https://www.parlonsrh.com/flux-rss/` | RSS | actualités RH, SIRH, digital | Élevée |
| Centre Inffo | `https://www.centre-inffo.fr/centre-inffo/nos-flux-rss` | RSS | formation, CPF, droit formation | Élevée |
| RH Info (ADP) | `https://www.fr.adp.com/rhinfo.aspx` | Page + sitemap | management, SIRH, paie | Moyenne |
| RH Matin | `https://www.rhmatin.com/` | Page + sitemap | SIRH, recrutement, digital learning | Élevée |
| News Tank RH | `https://rh.newstank.fr` | Page + sitemap | veille stratégique, politique emploi | Élevée |
| EDRH | `https://edrh.fr/flux-rss` | RSS | mobilités, évolution qualifications | Élevée |
| Liaisons Sociales | `https://www.liaisons-sociales.fr/` | Page + sitemap | droit social, jurisprudence | Élevée |
| DARES | `https://dares.travail-emploi.gouv.fr/` | API / sitemap | emploi, études RH | Élevée |

## Sources API (nécessitent clé utilisateur)

| Nom | API | Type | Clé requise | Usage |
|-----|-----|------|-------------|-------|
| NewsAPI | `https://newsapi.org` | API REST | `NEWSAPI_KEY` | Recherche par mots-clés "SIRH OR IA RH" |
| Google News RSS | `https://news.google.com/rss` | RSS | Non | Recherche thématique via paramètres URL |

## Sources à proscrire (promotionnelles ou peu fiables)

- Communiqués de presse d'éditeurs SIRH sans source tierce
- Blogs corporate non signés
- Contenu généré par IA non vérifié
- Sites d'affiliation RH

---

## Schéma de configuration source (Firestore)

```typescript
interface VeilleSource {
  id: string;
  name: string;
  url: string;
  type: 'rss' | 'sitemap' | 'api';
  apiKeyEnvVar?: string;   // ex: "NEWSAPI_KEY"
  keywords: string[];       // mots-clés de scan
  categories: string[];     // catégories SIRH ciblées
  active: boolean;
  lastScanAt: Timestamp;
  scanFrequency: 'daily' | 'weekly';
  reliabilityScore: number; // 0-100, config par défaut
}
```
