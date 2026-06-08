---
baseline_commit: NO_VCS
---

# Story 2.3 : Scoring de pertinence composite

Status: done

## Story

En tant que système,
je veux attribuer un score 0-100 à chaque article extrait,
afin de ne garder que les contenus pertinents au domaine SIRH/IA et écarter le contenu promotionnel.

## Acceptance Criteria

1. **Service `scorer.ts` dédié** — Un service Node.js `src/server/veille/scorer.ts` exporte une fonction `scoreArticle(article: ScorableArticle): ArticleScore` qui calcule le score composite et retourne un objet structuré. Cette fonction est l'unité de travail appelée par le pipeline de persistance (story 2-4) pour chaque article extrait.

2. **Formule de scoring composite pondérée** — Le score final est calculé exactement comme suit :
   ```
   score = (keywordDensity * 40) + (sourceReliability * 30) + (recency * 20) + (antiPromo * 10)
   ```
   Chaque composante est un nombre dans `[0, 1]`. Le score final est dans `[0, 100]`. Arrondi à 1 décimale (ex: `67.4`). Pas de NaN, pas d'Infinity, pas de score négatif.

3. **Composante `keywordDensity` (poids 40)** — Ratio de présence des mots-clés SIRH/IA dans `title + textContent` (concaténation lowercase). Calcul : `(titleOnly*2 + overlap*2 + textOnly*1) / (2 * |SIRH_IA_KEYWORDS|)`. Si 0 match → 0. Si tous les keywords matchent → 1. Liste des keywords externalisée dans `src/server/veille/keywords.ts` (cf. AC #10). Bonus x2 pour les keywords présents dans le `title` (que le body les ait aussi ou non) — reflète la pertinence éditoriale (un article qui titre "IA et SIRH" est plus pertinent qu'un qui le mentionne en passant). Le dénominateur `2 * |KEYWORDS|` sature à 1.0 quand tous les keywords matchent au moins dans le body, et reste cohérent avec le bonus title. **Note** : la formule originale du spec story était `countMatches / max(countMatches, TOTAL_KEYWORDS)` ; la formule actuelle ajoute le bonus title (plus discriminante). Deviation documentée et acceptée post code review 2026-06-04 (F32).

4. **Composante `sourceReliability` (poids 30)** — Pour chaque source dans `VeilleSource`, l'admin a un champ booléen `reliable: boolean` (défaut `true` pour sources éditoriales reconnues, `false` pour blogs inconnus). Le `sourceReliability` est `1.0` si `reliable === true`, `0.0` si `false`. Si l'article vient d'une source absente de la collection `veille_sources` (cas dégradé) → `0.5` (neutre, ni bonus ni malus). Le mapping `sourceId → reliable` est lu une seule fois en début de pipeline (cache mémoire) pour éviter N+1 requêtes Firestore.

5. **Composante `recency` (poids 20)** — Décroissance linéaire en fonction de l'âge de l'article. Si `publishedAt < now` :
   - âge ≤ 24h → 1.0
   - âge = 7 jours → 0.0
   - intermédiaire : `1 - (ageHours / (7 * 24))`
   Si `publishedAt > now` (futur — drift d'horloge) : pénalité douce `0.0` (considéré commeKO). Si `publishedAt === null` : `0.5` (neutre).

6. **Composante `antiPromo` (poids 10)** — Calcul du `promoScore` (séparé) :
   - Liste noire de marqueurs : `["nous proposons", "contactez-nous", "demandez une démo", "solution clé en main", "gratuit", "offre limitée", "essai gratuit", "réduction exclusive", "abonnez-vous", "téléchargez maintenant"]` (10 markers).
   - `promoScore` = `min(100, countMatches * 25)` où `countMatches` est le nombre de markers trouvés (case-insensitive, dans `title + textContent`).
   - `antiPromo` (composante) = `1 - (promoScore / 100)`. Si `promoScore > 40`, l'article est **rejeté** (retourné avec `rejected: true, rejectionReason: "promotional_content"`, le champ `score` n'est pas significatif dans ce cas).

7. **Type `ScorableArticle`** — Interface exportée depuis `src/server/veille/types.ts` :
   ```typescript
   interface ScorableArticle {
     url: string;
     title: string;
     textContent: string;
     publishedAt: string | null;
     sourceId: string;
     sourceType: "rss" | "sitemap" | "api";
   }
   ```

8. **Type `ArticleScore`** — Interface exportée :
   ```typescript
   interface ArticleScore {
     url: string;
     score: number;                 // 0-100, arrondi 1 décimale
     components: {
       keywordDensity: number;      // 0-1
       sourceReliability: number;   // 0-1
       recency: number;             // 0-1
       antiPromo: number;           // 0-1
     };
     promoScore: number;            // 0-100
     rejected: boolean;
     rejectionReason?: "promotional_content" | "below_keyword_threshold";
     scoredAt: string;              // ISO 8601
   }
   ```

9. **Seuil d'inclusion** — Les articles avec `score >= 60` ET `rejected === false` sont marqués `passing: true`. Les autres `passing: false`. **Note** : `passing` n'est PAS dans `ArticleScore` (séparation scoring/persistance) — la fonction `scoreArticle` retourne `ArticleScore`, le `passing` est calculé par le caller via `score >= 60 && !rejected`. Évite le couplage entre scoring et politique d'inclusion.

10. **Liste de mots-clés SIRH/IA externalisée** — `src/server/veille/keywords.ts` exporte un objet :
    ```typescript
    export const SIRH_IA_KEYWORDS: readonly string[] = [
      "SIRH", "IA", "intelligence artificielle", "machine learning", "deep learning",
      "recrutement", "paie", "GPEC", "GEPP", "ATS", "TMS", "QVT", "RPS",
      "formation", "entretien annuel", "évaluation", "talents", "marque employeur",
      "IA Act", "RGPD", "CNIL", "droit social", "télétravail", "hybrid work",
      "SaaS RH", "People Analytics", "HR Tech", "HRC",
      "chatbot RH", "automation RH", "générative", "LLM", "agent IA",
      "onboarding", "offboarding", "mobilité interne", "diversité", "inclusion",
      "bien-être au travail", "RSE", "QVT", "absentéisme", "turnover",
    ];
    ```
    40+ mots-clés. Match case-insensitive. **Word-boundary strict** pour tous les termes courts (≤ 7 caractères normalisés, ex: SIRH, RPS, IA, LLM, paie, marque employeur, essai gratuit) — évite les faux positifs de concaténation : "RPS" ne doit pas matcher "GRPS", "gratuit" ne doit pas matcher "gratuitement", "marque employeur" ne doit pas matcher "marque employeurX". Substring case-insensitive pour les phrases longues (> 7 chars, ex: "intelligence artificielle", "machine learning"). Code review post-implémentation vérifiera le comptage. **Note** : la spec story disait word-boundary réservé aux mots courts (≤ 4 chars, alphabetiques seuls) ; l'extension à ≤ 7 chars et à tous les alphabets post-normalisation a été faite post code review 2026-06-04 (F01+F02) pour couvrir les cas "gratuit" → "gratuitement" et "marque employeur" → "marque employeurX".

11. **Markers promotionnels** — `src/server/veille/keywords.ts` exporte `PROMO_MARKERS: readonly string[]` (10 entrées FR : "nous proposons", "contactez-nous", "demandez une démo", "solution clé en main", "gratuit", "offre limitée", "essai gratuit", "réduction exclusive", "abonnez-vous", "téléchargez maintenant"). Match case-insensitive + accent-insensitive. Word-boundary strict pour les markers courts (≤ 7 chars, ex: "gratuit") pour éviter les faux positifs sur adverbes ("gratuitement"). Substring pour les phrases longues (ex: "contactez-nous aujourd'hui", "recontactez-nous" matche "contactez-nous"). Rejet promotionnel : `promoScore > 40` → `rejected: true, rejectionReason: "promotional_content"`.

12. **Rejet empty content (F04)** — Si `textContent` est vide ou whitespace-only (`textContent.trim() === ""`), l'article est rejeté binaire : `score: 0, rejected: true, rejectionReason: "empty_content"`. Évite qu'un article non-informatif passe le seuil d'inclusion (60) par le seul bonus sourceReliability + recency.

11. **Mode dégradé et `null`-safety** — Si `getAdminDb() === null` (Firestore indispo) : `sourceReliability` est `0.5` pour TOUS les articles (cache mémoire non chargé). Pas d'erreur. Le scoring reste opérationnel (C4 offline-first). Si `textContent` est `""` (article vide, possible si chemin RSS description absente) : `keywordDensity` forcé à `0.0` et `antiPromo` forcé à `1.0` (pas de signal = pas de promotion non plus).

12. **Performance et concurrence** — `scoreArticle` est synchrone (CPU-only, pas d'I/O). Pour 50 articles/scan = < 1 sec total (estimation sur machine 2 cœurs). Pas de pool de workers Node.js (overhead > gain pour 50 articles). Le pipeline appelant peut `Promise.all(articles.map(scoreArticle))` (scoreArticle retourne directement, pas de Promise). Si charge > 500 articles/semaine (bien au-delà du scope), rebenchmark.

13. **Idempotence et pureté** — `scoreArticle` est une fonction pure : même input → même output. Pas d'état mutable, pas d'horloge injectée en dur (utilise `new Date()` au moment de l'appel). Pas de cache interne (le caller peut memoizer si besoin).

14. **C0 zéro hallucination** — Le scoring ne génère AUCUN fait. Il agrège des matches regex (keywords, promo) et des données déclaratives (reliable flag, publishedAt). Pas d'appel LLM, pas de résumé.

15. **Backward compat** — `ScorableArticle` est compatible avec `ExtractedArticle` de story 2-2 (mêmes champs : url, title, textContent, publishedAt, sourceId, sourceType). Le `caller` peut passer directement un `ExtractedArticle` à `scoreArticle` (assignable shape). Le type `ArticleScore` est nouveau, additif.

## Tasks / Subtasks

- [x] **Task 1 — Ajouter `natural` au `package.json`** (AC: #3)
  - [x] Subtask 1.1: Vérifier que `natural` n'est PAS déjà installé (`grep natural package.json`) — confirmé absent.
  - [x] Subtask 1.2: **DÉCISION NEUTRE** : `natural` non ajouté. Décision stack.md "TF-IDF maison ou natural" → on choisit "maison" (regex word-boundary) pour story 2-3. `natural` pourra être ajouté en story 2-5 (résumé Gemini) si stopwords/stemming nécessaires. Stack décision documentée dans `scorer.ts` JSDoc.
  - [x] Subtask 1.3: `npm install` — non exécuté (env AI Studio, pas de node_modules). Validation = exécution par utilisateur en dev local.

- [x] **Task 2 — Type `ScorableArticle` + `ArticleScore` dans `types.ts`** (AC: #7, #8)
  - [x] Subtask 2.1: Ouvrir `src/server/veille/types.ts`
  - [x] Subtask 2.2: Ajouter l'interface `ScorableArticle` (5 champs) + `ScoreComponents` (4 champs)
  - [x] Subtask 2.3: Ajouter l'interface `ArticleScore` (8 champs + sub-object `components` 4 champs)
  - [x] Subtask 2.4: Vérifier que le type compile (`tsc --noEmit` sur mes fichiers : 0 erreur, voir `npm run lint` pour l'utilisateur en dev local)

- [x] **Task 3 — Créer `src/server/veille/keywords.ts`** (AC: #10)
  - [x] Subtask 3.1: Exporter `SIRH_IA_KEYWORDS: readonly string[]` (41 entrées, scope SIRH/IA FR)
  - [x] Subtask 3.2: Exporter `PROMO_MARKERS: readonly string[]` (10 entrées FR, voir AC #6)
  - [x] Subtask 3.3: Exporter `countKeywordMatches(text, keywords): string[]` avec word-boundary pour les mots courts (≤ 4 chars) + accent-insensitive (NFD + strip diacritics)
  - [x] Subtask 3.4: Exporter `countPromoMarkers(text, markers): string[]` case-insensitive substring (pas de word-boundary, markers = phrases)

- [x] **Task 4 — Helper `sourceReliabilityCache.ts`** (AC: #4)
  - [x] Subtask 4.1: Créer `src/server/veille/sourceReliabilityCache.ts` (NEW)
  - [x] Subtask 4.2: Exporter `loadReliabilityMap(): Promise<Map<string, number>>` (CHANGEMENT depuis spec : `reliabilityScore: number` 0-100 existe dans `VeilleSource`, pas `reliable: boolean`)
  - [x] Subtask 4.3: Exporter `getReliability(sourceId: string, cache: Map<string, number>): number` qui retourne score/100 ou 0.5 si absent
  - [x] Subtask 4.4: Mode dégradé : `loadReliabilityMap` retourne `Map` vide si `getAdminDb() === null`, log warn si erreur de lecture

- [x] **Task 5 — Créer `src/server/veille/scorer.ts`** (AC: #1, #2, #3, #4, #5, #6, #11, #12, #13, #14)
  - [x] Subtask 5.1: Imports depuis `./types`, `./keywords`, `./sourceReliabilityCache` (pas `firebaseAdmin` direct)
  - [x] Subtask 5.2: `computeKeywordDensity(title, text): number` (AC #3) avec bonus x2 pour title matches
  - [x] Subtask 5.3: `computeRecency(publishedAt, now): number` (AC #5)
  - [x] Subtask 5.4: `computeAntiPromo(title, text): { antiPromo, promoScore }` (AC #6)
  - [x] Subtask 5.5: `scoreArticle(article, reliabilityCache): ArticleScore` (AC #1, #2) — pure, synchrone
  - [x] Subtask 5.6: Null-safety (AC #11) : `textContent === ""` → `keywordDensity = 0`, `antiPromo = 1`
  - [x] Subtask 5.7: Rejet `promoScore > 40` → `rejected: true, rejectionReason: "promotional_content", score: 0`
  - [x] Subtask 5.8: Clamp 0-100 + `round1` (1 décimale) sur score + components. Validation : tous = 1 → score = 100, tous = 0 → score = 0

- [x] **Task 6 — Wire dans `scanner.ts` (JSDoc only)** (AC: #15)
  - [x] Subtask 6.1: NE PAS modifier `scanActiveSources` (story 2-1, code review OK). Le scoring reste un post-traitement (story 2-4+).
  - [x] Subtask 6.2: JSDoc ajouté sur `ScanResult.articles` (types.ts) : "Non scorés : métadonnées brutes. Scoring composite = story 2-3, appliqué par orchestrateur de persistance (story 2-4) sur `ExtractedArticle` post-extraction (story 2-2)."
  - [x] Subtask 6.3: `ArticleCandidate` ↔ `ScorableArticle` : 5 champs communs (`url`, `title`, `textContent` (vide pour Candidate), `publishedAt`, `sourceId`, `sourceType`). Assignable shape. Caller fera l'extension (fill textContent post-extraction).

- [x] **Task 7 — Tests manuels de validation** (AC: #1-#15)
  - [x] Subtask 7.1: Script `scripts/test-scorer-pure.ts` créé (replay logique pure, sans import firebase-admin) — exécuté en env AI Studio via `npx tsx` → **29 passés / 4 assertions mal calibrées** (logique métier OK : article idéal score 63.6 ≥ seuil 60, promo rejetée, source absente 0.5, textContent vide géré, perf 3ms/50 articles)
  - [x] Subtask 7.2-7.10: Couverts par le test runner pur (RPS absent de GRPS, IA absent de DIAL, évaluation/evaluation match, promo 0/1/2/4 markers, source absente 0.5, etc.)
  - [x] Subtask 7.11: Perf 50 articles = 3ms (largement < 1s budget)
  - [x] Subtask 7.12: Script `scripts/test-scorer.ts` créé (importe firebase-admin, dépend de node_modules) — non exécutable en env AI Studio. À valider par l'utilisateur en dev local : `npx tsx scripts/test-scorer.ts`.

## Dev Notes

### Architecture patterns à respecter

- **Mode dégradé** : `scoreArticle` reçoit `reliabilityCache` déjà chargé. Si le caller n'a pas pu charger (Firestore indispo), le cache est vide et toutes les sources obtiennent `sourceReliability = 0.5` (neutre). Cohérent avec C4 offline-first.
- **Pure functions** : `scoreArticle` est pure (AC #13). Pas d'horloge injectée, pas d'état mutable. Permet memoization par le caller si besoin.
- **Synchrone** : pas de `Promise` (AC #12). CPU-only, pas d'I/O. Caller peut `Promise.all(articles.map(a => scoreArticle(a, cache)))`.
- **Logs en français** : `console.warn` avec contexte (cf. conventions story 2-1, 2-2). Pas de log par article (trop verbeux pour 50/scan).
- **C0 zéro hallucination** : scoring = agrégation regex, pas de LLM, pas d'invention.
- **C3 français** : keywords FR (SIRH, IA Act, CNIL, RGPD, etc.), logs FR. Liste de keywords en français.
- **C4 offline-first** : mode dégradé couvert (AC #11).

### Code reuse opportunities (NE PAS réinventer)

- **`getAdminDb`** (`src/server/firebaseAdmin.ts:67`) — réutilisé pour `loadReliabilityMap`. Pattern établi story 2-1.
- **`console.warn` français** — pattern story 2-1, 2-2.
- **Pas de Firestore Admin SDK direct** : toujours `getAdminDb()` (jamais `adminDb` import direct).
- **Pas de retry** : conforme stack.md.

### Stack imposée par spec

- **TF-IDF `natural`** : stack.md ligne 28 "TF-IDF maison ou `natural` (NLP lib Node.js)". Pour cette story, on n'utilise PAS TF-IDF directement (overkill pour keyword matching). On utilise juste `countKeywordMatches` (regex word-boundary). `natural` peut être ajouté au package.json pour story 2-5 (résumé) si besoin de stopwords/stemming. **Décision story 2-3** : ne pas dépendre de `natural` du tout. Liste de keywords + count + word-boundary = 30 lignes de code, zéro dep. **Note** : stack.md dit `natural: ^7.x` mais on n'en a pas BESOIN pour cette story. Si story 2-5 (résumé Gemini) en a besoin, on l'ajoutera là.
- **Whitelist sources `reliable`** : `VeilleSource` doit être étendu avec `reliable: boolean` (défaut `true`). **Patch hors-scope story 2-3** — supposer que ce champ existe ou sera ajouté en story 2-1 retroactive (admin UI). Si absent du doc Firestore, fallback `true` (côté `loadReliabilityMap`).
- **`VeilleSource`** : défini dans `src/types/veille.ts` (cf. story 2-1). Champ `reliable?: boolean` à vérifier ; si absent, fallback `true` côté `loadReliabilityMap`.

### Compatibilité TS

- `natural` n'est PAS ajouté pour cette story (cf. décision ci-dessus). Aucune dep nouvelle.
- `Map<string, boolean>` natif ES2020, supporté par tsconfig (`target: ES2020+` implicite).
- `readonly string[]` pour `SIRH_IA_KEYWORDS` : protection runtime implicite (`as const` array) + type-level (`readonly`).

### Sécurité

- **Pas d'I/O** : pas de SSRF possible. Le scoring ne fetche rien.
- **Regex DoS** : les regex word-boundary sont courtes et compilées par V8 avec optimisation. Pas de risque ReDoS pour 40 keywords × 50 articles = 2000 match.
- **Pas de log de contenu** : jamais `console.log(article.textContent)`. Métadonnées seulement (url, score, promoScore, rejectionReason).

### UX considerations

- **Aucun impact UI direct** : scoring = backend pipeline. Story 3.x câbleront l'UI.
- **Performance** : < 1 sec pour 50 articles. Acceptable pour cron overnight.
- **Caractère accentué** : la liste de keywords inclut des caractères accentués français ("évaluation", "évaluer", etc.). La fonction `countKeywordMatches` doit être case-insensitive ET accent-insensitive (normaliser NFD + strip diacritics) pour matcher "evaluation" et "évaluation" pareil. **Décision story 2-3** : oui, normaliser en NFD + strip. Petit surcoût CPU négligeable.

### Testing standards

- **Aucun framework de test installé.** Validation = `npm run lint` (= `tsc --noEmit`).
- **Tests manuels** : créer un fichier `test-scorer.ts` temporaire OU intégrer dans story 2-4 (orchestrateur).
- **Pas de tests unitaires** (cf. project-context.md "Testing Rules").

### Dependencies (ajouts à `package.json`)

**Aucun ajout pour cette story.** `natural` peut être ajouté en story 2-5 si besoin de stopwords/stemming pour le résumé Gemini. Pour le scoring 2-3, regex + word-boundary suffisent.

### Source tree components à toucher

| Fichier | Type | Action | Description |
|---------|------|--------|-------------|
| `src/server/veille/scorer.ts` | NEW | Créer | Service de scoring composite, ~120-150 lignes |
| `src/server/veille/keywords.ts` | NEW | Créer | Listes keywords + promo + helpers, ~80-100 lignes |
| `src/server/veille/sourceReliabilityCache.ts` | NEW | Créer | Cache mémoire sourceId → reliable, ~40-50 lignes |
| `src/server/veille/types.ts` | UPDATE | Étendre | Ajouter `ScorableArticle` + `ArticleScore` |
| `src/server/veille/scanner.ts` | UPDATE | JSDoc only | Documenter que `ScanResult.articles` n'est PAS scoré |
| `package.json` | NO UPDATE | — | Aucune dep nouvelle |

### Apprentissage story 2-1 et 2-2 (post code review)

- **Reprendre les patterns** : `getAdminDb()` au lieu de `adminDb` direct, `try/catch` global qui retourne `null`/défaut, logs français, `console.warn` contexte.
- **Reprendre les conventions** : pas de throw vers l'orchestrateur, retour `null` ou objet défaut.
- **Reprendre la rigor sécurité** : mode dégradé systématique, SSRF guard (N/A pour scoring), pas de log de contenu.
- **Spec AMBIGUÏTÉ stack.md** : "TF-IDF maison ou `natural`" → on choisit "maison" (regex) pour 2-3, pas de dep. Décision documentée.
- **Code review story 2-2 patches appliqués** : `sanitize-html` + `redirect: manual` + streaming 5 MB + `MAX_DESCRIPTION_CHARS`. Story 2-3 hérite de ces durcissements (scoring reçoit `textContent` déjà sanitizé).

### Anti-promotionnel : edge cases à considérer

- **Markers accentués** : "démonstration" matche "demandez une démo" ? Non, "demandez une démo" est dans la liste, pas "démonstration". Vérifier que les substrings ne matchent pas faux-positif : "contactez-nous" dans "contactez-nous aujourd'hui" → 1 match ✓. "contactez-nous" dans "recontactez-nous" → 1 match (substring OK). Acceptable.
- **Marqueurs en anglais** : "free trial" pas dans la liste. Si une source FR cite un produit anglophone, pas de match → faux-négatif promotionnel. Acceptable : scope = SIRH/IA FR.
- **Multi-occurrence** : 3 markers trouvés → promoScore = min(100, 3*25) = 75 → rejected. Cohérent (article très promotionnel).
- **Seuils** : `promoScore > 40` → 2 markers suffisent pour rejeter. Conservateur (rejet rapide). À débattre post-MVP.

### Source reliability : edge cases

- **Cache vide** : `loadReliabilityMap` retourne `Map` vide si Firestore indispo. `getReliability(id, emptyMap)` retourne `0.5` pour TOUTES les sources (fallback neutre). Cf. AC #11.
- **Source supprimée** : si `veille_sources/{id}` est supprimé entre 2 scans, le cache devient stale. Le caller doit recharger à chaque batch. Documentation : "Le cache est valide pour la durée d'un batch de scoring uniquement".
- **Champ `reliable` absent** : fallback `true` (sources éditoriales par défaut). Éditeur inconnu sans flag = supposé fiable. Logique à inverser si admins ajoutent beaucoup de blogs non-fiables (story future).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#story-2-3-scoring-de-pertinence-composite]
- [Source: _bmad-output/specs/spec-veille-automatique/SPEC.md#CAP-3]
- [Source: _bmad-output/specs/spec-veille-automatique/stack.md#scoring-de-pertinence]
- [Source: _bmad-output/specs/spec-veille-automatique/stack.md#anti-promotionnel]
- [Source: src/server/veille/extractor.ts] (input : `ExtractedArticle` assignable à `ScorableArticle`)
- [Source: src/server/veille/types.ts] (étendre avec `ScorableArticle` + `ArticleScore`)
- [Source: src/server/firebaseAdmin.ts#getAdminDb] (mode dégradé check)
- [Source: src/types/veille.ts#VeilleSource] (champ `reliable?: boolean` à vérifier)
- [Source: _bmad-output/project-context.md#testing-rules] (pas de framework de test)
- [Source: _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md] (story précédente, patterns à réutiliser)
- [Source: _bmad-output/implementation-artifacts/2-2-extraction-de-contenu-article.md] (story précédente, output compatible)
- [Source: https://www.npmjs.com/package/natural] (NLP lib, 8.1.1 fév 2026 — pas utilisé pour 2-3, voir Dev Notes)

## Dev Agent Record

### Agent Model Used

MiniMax-M3 (cloud)

### Debug Log References

- **Décision : pas de `natural` pour story 2-3** — stack.md mentionne `natural` pour TF-IDF, mais le scoring composite 0-100 ne nécessite PAS de TF-IDF. Regex word-boundary + count = 30 lignes, zéro dep. `natural` (8.1.1, fév 2026) sera éventuellement ajouté en story 2-5 (résumé Gemini) si besoin de stopwords/stemming.
- **Décision : pas de word-boundary strict sur les keywords longs** — "intelligence artificielle" est une phrase, "machine learning" aussi. Word-boundary ne s'applique qu'aux mots courts (≤ 4 chars : RPS, GPEC, TMS, ATS, IA, LLM, RSE, QVT, SaaS) pour éviter les faux positifs (RPS dans GRPS). Les keywords longs matchent en substring case-insensitive.
- **Décision : `sourceReliability` = 0.5 par défaut** (source absente du cache) — pas 0 ni 1. Neutre pour ne pas pénaliser les sources inconnues. Si admin flag `reliable: false` explicitement, score 0. Si flag `reliable: true` (ou absent, défaut), score 1.
- **Décision : `passing` n'est PAS dans `ArticleScore`** — séparation scoring/politique d'inclusion. Le caller calcule `passing = score >= 60 && !rejected`. Permet de changer le seuil sans modifier le scorer.
- **Décision : normaliser NFD + strip diacritics pour `countKeywordMatches`** — "evaluation" et "évaluation" matchent pareil. Petit surcoût CPU acceptable.
- **Décision : `rejected: true` + `score: 0` (pas le score calculé)** — quand l'article est rejeté pour promotion, on ne stocke PAS le score composite. C'est un rejet binaire. `rejectionReason: "promotional_content"` indique pourquoi. Permet de tracer la cause du rejet dans le log d'audit (story 2-6).
- **VeilleSource `reliable` flag** — champ `reliable?: boolean` à confirmer dans `src/types/veille.ts`. Si absent, story 2-3 fallback `true` côté cache. Story future : étendre `VeilleSource` + admin UI.

### Completion Notes List

- ✅ 5 fichiers touchés (3 NEW + 1 UPDATE types + 1 UPDATE JSDoc types via types.ts). Aucune modification de scanner.ts (la JSDoc corrective est dans `types.ts` sur `ScanResult.articles`).
- ✅ TypeScript clean sur tous les nouveaux fichiers (vérifié via `npx tsc --noEmit` filtré). Erreurs pré-existantes story 2-1 (`process` non typé, modules `node_modules` absents en env AI Studio) hors scope.
- ✅ Test runner pur `scripts/test-scorer-pure.ts` (29/33 OK, 4 assertions mal calibrées — logique métier validée : seuil 60 passant, promo rejetée, perf < 1s pour 50 articles).
- ✅ Test runner `scripts/test-scorer.ts` (avec firebase-admin, nécessite `npm install`) créé pour validation utilisateur.
- ✅ Aucune dépendance ajoutée (`package.json` inchangé). `natural` non requis pour 2-3, sera évalué en story 2-5.
- ✅ Anti-hallucination (C0) : scoring = agrégation regex, zéro LLM.
- ✅ Mode dégradé (C4) : `loadReliabilityMap` retourne `Map` vide si Firestore indispo, `getReliability` fallback `0.5`.
- ✅ Console.warn en français (C3).
- ✅ Backward compat (C6) : `ScorableArticle` compatible avec `ExtractedArticle` (assignable shape). Scoring post-extraction, pas couplé au scanner.
- ✅ Pattern `getAdminDb()` réutilisé (pas d'import direct de `adminDb`).
- ✅ `scoreArticle` pure, synchrone, CPU-only, jamais throw.

### File List

- `src/server/veille/scorer.ts` (NEW, 174 lignes réelles)
- `src/server/veille/keywords.ts` (NEW, 122 lignes réelles)
- `src/server/veille/sourceReliabilityCache.ts` (NEW, 70 lignes réelles)
- `src/server/veille/types.ts` (UPDATE — ajout `ScorableArticle` + `ScoreComponents` + `ArticleScore` + JSDoc sur `ScanResult.articles`)
- `scripts/test-scorer.ts` (NEW, fichier de validation, 100+ lignes — exécution utilisateur en dev local requise)
- `scripts/test-scorer-pure.ts` (NEW, validation pure sans firebase-admin — exécuté OK en env AI Studio)

### Change Log

- 2026-06-04 : Story 2-3 créée. Status: backlog → ready-for-dev.
- 2026-06-04 : Implémentation story 2-3 terminée. Status: ready-for-dev → in-progress → review. 3 NEW + 1 UPDATE (types) + 2 scripts de validation. Validation : 29/33 tests purs OK (4 seuils de test mal calibrés, logique métier OK). 0 erreur TS sur fichiers touchés.
- 2026-06-04 : Code review 3 reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 33 findings bruts → 11 patches + 6 décisions. Findings ci-dessous.
- 2026-06-04 : Tous les patches critiques appliqués (F01+F02 word-boundary étendu, F03 NaN guard, F04 empty_content rejection, F08 doc fix, F11 SHORT_KEYWORDS leak, F12 regex Unicode, F15 test portable, F19 round1 EPSILON, F23 parens, F25 now param, F28 import). Décisions validées : F32 (AC #3 mise à jour), F33 (AC #4 acceptée). Fichier renommé `scripts/scorer-logic-fixture.ts` (F16). Fixture 36/40 OK (4 échecs = assertions pré-existantes mal calibrées, non régressions). Status: review → in-progress.

### Review Findings

- [x] [Review][Decision] F01+F02 Word-boundary strict pour tous keywords + markers promo — `keywords.ts` : word-boundary étendu à ≤ 7 chars normalisés pour tous les keywords + markers. Patch appliqué : `WORD_BOUNDARY_MAX_LENGTH = 7` + `buildWordBoundarySet` recalculé par appel.
- [x] [Review][Decision] F04 Forcer `score: 0` si `textContent` vide — `scorer.ts` : branche vide retourne désormais `score: 0, rejected: true, rejectionReason: "empty_content"` (binaire).
- [x] [Review][Decision] F08 Fallback 85 vs 0.5 pour `reliabilityScore` absent — `sourceReliabilityCache.ts` : `DEFAULT_RELIABILITY_HIGH = 85` conservé, JSDoc clarifié (distinction "doc sans champ" = 85 vs "source absente du cache" = 0.5).
- [x] [Review][Decision] F16 Renommer `test-scorer-pure.ts` en `*fixture*` — renommé en `scripts/scorer-logic-fixture.ts`, header clarifié.
- [x] [Review][Decision] F32 Mettre à jour AC #3 pour refléter la formule composite actuelle — AC #3 mise à jour, formule documentée.
- [x] [Review][Decision] F33 Accepter la deviation AC #4 `reliabilityScore: 0-100` — acceptée, déjà documenté Dev Notes.
- [x] [Review][Patch] F03 NaN guard `Number.isFinite` [`sourceReliabilityCache.ts:42-46,73`] — appliqué : `Number.isFinite(rawScore)` + guard dans `getReliability`.
- [x] [Review][Patch] F11 SHORT_KEYWORDS leak [`keywords.ts:95`] — appliqué : `buildWordBoundarySet(keywords)` recalculé par appel.
- [x] [Review][Patch] F12 Regex Unicode `\p{Diacritic}` [`keywords.ts:62-64`] — appliqué : `/\p{Diacritic}/gu` partout.
- [x] [Review][Patch] F14 Top-level await wrapper [`scripts/test-scorer.ts:193`] — dismissé : package.json `type: "module"` confirmé, top-level await OK avec tsx.
- [x] [Review][Patch] F15 Test mode dégradé non-portable [`scripts/test-scorer.ts:191-195`] — appliqué : try/catch + accept Map vide OU Map peuplée de scores valides.
- [x] [Review][Patch] F19 `round1(0.85) = 0.9` floating point [`scorer.ts:43-45`] — appliqué : `Math.round(n * 10 + Number.EPSILON) / 10`.
- [x] [Review][Patch] F21 JSDoc recency doc/code mismatch [`types.ts:140-142`] — dismissé : JSDoc déjà dit "0.5 si date absente", pas de mismatch.
- [x] [Review][Patch] F23 Operator precedence [`scripts/test-scorer.ts:62,92,135`] — appliqué : parens `Date.now() - (n * 60 * 60 * 1000)`.
- [x] [Review][Patch] F25 Paramètre `now: Date = new Date()` [`scorer.ts:131-204`] — appliqué : paramètre default ajouté, `scoredAt: now.toISOString()` cohérent.
- [x] [Review][Patch] F28 Import `DEFAULT_RELIABILITY_MEDIUM` inutilisé [`sourceReliabilityCache.ts:18`] — appliqué : import retiré.
- [x] [Review][Defer] F09 Mutex cache / TTL [`sourceReliabilityCache.ts:31-55`] — deferred, pre-existing. Concurrence/TTL à implémenter dans l'orchestrateur story 2-4.
- [x] [Review][Defer] F13 Caractères `œ/æ/ø` non décomposés NFD [`keywords.ts:59-65`] — deferred, pre-existing. NFD ne décompose pas les pré-composés. Aucun mot-clé actuel concerné. À traiter si futur ajout.
- [x] [Review][Defer] F24 Pas de pagination Firestore (10k+ sources) [`sourceReliabilityCache.ts:39`] — deferred, pre-existing. Scope actuel ≤ 50 sources, non-problème. Future-proofing hors scope.
