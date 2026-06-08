# Code Review Triage — Story 2-3 (scoring de pertinence composite)

**Date** : 2026-06-04
**Reviewers** : Blind Hunter, Edge Case Hunter, Acceptance Auditor
**Spec** : story 2-3 (15 AC + 7 tasks), CAP-3
**Mode** : full

## Findings normalisés

### Acceptance Auditor (synthèse par AC)

| AC | Verdict | Détail |
|----|---------|--------|
| #1 | ✅ | `scoreArticle` exporté, signature OK |
| #2 | ✅ | Formule exacte, weights documentés, clamp anti-NaN |
| #3 | ⚠️ | **DEVIATION** : formule `total / (2 * \|KEYWORDS\|)` ≠ spec `countMatches / max(countMatches, TOTAL_KEYWORDS)`. Les deux sont mathématiquement valides, pas équivalentes. |
| #4 | ⚠️ | **DEVIATION DOCUMENTÉE** : utilise `reliabilityScore: 0-100` au lieu de `reliable: boolean` (déjà noté dans Dev Notes, `VeilleSource` schéma existant) |
| #5 | ✅ | Recency tous cas OK |
| #6 | ✅ | Rejet binaire, threshold `> 40` explicite |
| #7 | ✅ | ScorableArticle 5 champs |
| #8 | ✅ | ArticleScore 7+4 champs, `rejectionReason` typé |
| #9 | ✅ | `passing` hors ArticleScore, seuil 60 dans JSDoc |
| #10 | ✅ | 41 keywords, word-boundary mots courts, accent-insensitive |
| #11 | ✅ | Mode dégradé complet |
| #12 | ✅ | Synchrone, CPU-only, 3ms/50 articles mesuré |
| #13 | ✅ | Pure (sauf `new Date()` interne) |
| #14 | ✅ | Pas d'import LLM |
| #15 | ✅ | Backward compat shape |

### Findings fusionnés (par priorité)

#### 🔴 CRITICAL (patch obligatoire)

**[F01] `keywords.ts:36,38` — "gratuit" substring matche "gratuitement"** 🟡high
- Source: Edge Case Hunter
- Location: `src/server/veille/keywords.ts:36` (PROMO_MARKERS ligne 36: `"gratuit"`)
- Detail: `countPromoMarkers("Cet outil est gratuitement accessible à tous", PROMO_MARKERS)` retourne 1 marker au lieu de 0. Faux positif promo massif dans le FR éditorial (l'adverbe "gratuitement" est courant). Un seul faux positif peut suffire à approcher le seuil de rejet (25 points), deux dépassent (>40).
- Trigger: texte FR contenant "gratuitement", "gratuite", "gratuits", "gratuité".
- Fix: ajouter word-boundary pour markers de longueur ≤ 7 OU reformuler en phrases ("100% gratuit", "est gratuit"). Plus simple : appliquer la même logique `SHORT_KEYWORDS` aux markers de longueur ≤ 7.

**[F02] `keywords.ts:60-72` — keywords longs matchent en substring (pas de word-boundary)** 🟡medium+high
- Source: Blind Hunter + Edge Case Hunter (merged)
- Location: `src/server/veille/keywords.ts:87-106` (`countKeywordMatches` branche `text.includes`)
- Detail: `"marque employeur"` matche `"marque employeurX"`, `"SaaS RH"` matche `"SaaS RHPro"`, `"intelligence artificielle"` matche `"pseudo-intelligence artificielle-ment"`. Faux positifs éditoriaux (concaténation accidentelle dans le body).
- Fix: appliquer `\b…\b` ASCII à TOUS les keywords (post-NFD où tous caractères sont ASCII), ou ajouter un contrôle "caractère alphanum en bordure" via regex. **Patch plus simple** : utiliser `RegExp(\`\\b${escaped}\\b\`)` systématiquement — la branche SHORT_KEYWORDS existe déjà, juste l'étendre à tous.

**[F03] `sourceReliabilityCache.ts:42-47` — `typeof NaN === "number"` laisse passer NaN** 🟡high
- Source: Edge Case Hunter
- Location: `src/server/veille/sourceReliabilityCache.ts:42-46`
- Detail: `typeof data.reliabilityScore === "number"` retourne `true` pour `NaN` (NaN est de type number en JS). `Math.min(100, NaN) = NaN`, `Math.max(0, NaN) = NaN`. Le clamp laisse passer NaN dans la Map. `getReliability` retourne `NaN / 100 = NaN` → le score composite explose.
- Fix: remplacer par `typeof data.reliabilityScore === "number" && Number.isFinite(data.reliabilityScore)`. Idem dans `getReliability` (ligne 73) : ajouter `if (!Number.isFinite(score)) return 0.5;`.

**[F04] `scorer.ts:136-156` — article vide (textContent whitespace) peut atteindre score=60 pile** 🟡high
- Source: Edge Case Hunter
- Location: `src/server/veille/scorer.ts:136-156`
- Detail: avec `textContent: "   "`, sourceReliability=1.0, recency=1.0, on obtient `0*40 + 1*30 + 1*20 + 1*10 = 60` pile → passe le seuil d'inclusion `>= 60`. Un article complètement vide est inclus dans le rapport.
- Fix: forcer `score: 0` (ou `rejectionReason: "empty_content"`) quand `textContent.trim()` est vide. Permet d'écarter proprement ces articles non-informatifs.

#### 🟡 MEDIUM (patch recommandé)

**[F05] `scorer.ts:62-77` — `computeKeywordDensity` n'est pas normalisé par longueur de texte** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:74-76`
- Detail: un article de 50 mots qui matche 5 keywords obtient `5/82 ≈ 0.06`. Un article de 2000 mots qui matche 5 keywords obtient le même score. Pas de biais longueur — c'est cohérent avec le design. **Mais** : un article exhaustif qui matche 30 keywords en textOnly obtient `30/82 ≈ 0.37`, tandis qu'un article moins long qui matche les mêmes 30 en title+overlap atteint `60/82 ≈ 0.73`. La normalisation par longueur n'est pas demandée par la spec. Le design actuel est **cohérent** mais peut être amélioré.
- Fix: **DECISION NEEDED** : (a) accepter le design actuel (recommandé — spec le décrit comme `countMatches / max(countMatches, TOTAL_KEYWORDS)`); (b) ajouter une normalisation par `log(textLength)`. Pour cette story, on garde le design et on clarifie la JSDoc. **Patch léger** : ajouter une note "non normalisé par longueur, par design".

**[F06] `scorer.ts:74` — `overlap` est pondéré x2 (devient identique à titleOnly)** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:74`
- Detail: `total = titleOnly*2 + overlap*2 + textOnly*1`. Un keyword en `overlap` (title+text) score 2, comme un keyword en `titleOnly` (title seul). L'intent du bonus x2 était de **distinguer** title du body, pas de les fusionner. Le commentaire JSDoc dit "title-only = 2 points, overlap = 2 points (title + body)" — correct mais contre-intuitif. Si l'intent est "title présent" → bonus, alors `overlap` devrait aussi avoir 2 (c'est le cas ✓). Si l'intent est "title SEUL" → bonus, alors `overlap` devrait être 1.
- Fix: **DECISION NEEDED** : le design actuel est cohérent (un keyword pertinent dans le title est un signal fort, qu'il soit aussi dans le body ou non), mais le commentaire est ambigu. **Patch léger** : clarifier la JSDoc pour dire "présence dans le title = bonus x2, qu'il y ait ou non match dans le body".

**[F07] `scorer.ts:166` — seuil `promoScore > 40` (strict) est trop agressif** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:166`
- Detail: 2 markers = 50 → rejeté, 1 marker = 25 → passe. Avec le fix F01 qui ajoute des faux positifs, le seuil devient problématique (un article "gratuitement + téléchargement PDF" est rejeté). Le design actuel binaire est volontaire (spec l'accepte).
- Fix: **DECISION NEEDED** : (a) accepter le seuil strict (rejet conservateur, aligné avec spec AC #6 "promoScore > 40"), (b) monter à 50 (besoin de 3 markers pour rejet), (c) ajouter une whitelist d'exceptions (regex négative). Pour cette story, on garde `> 40` (conforme spec). Patch = aucune action, juste documenter le trade-off.

**[F08] `sourceReliabilityCache.ts:44` — fallback `DEFAULT_RELIABILITY_HIGH = 85` pour champ absent** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/sourceReliabilityCache.ts:42-44`
- Detail: un doc Firestore avec `reliabilityScore` manquant (legacy import, doc créé avant le champ) est traité comme **très fiable** (85/100), alors que `getReliability` retourne 0.5 (neutre) pour les sources **absentes du cache** (c'est-à-dire filtrées par Firestore rules). Inconsistance : "absent du doc" ≠ "absent du cache". Le doc sans champ n'est PAS moins fiable qu'un doc présent avec champ ; il est juste **non-évalué**.
- Fix: **DECISION NEEDED** : (a) garder 85 (doc sans champ = réputé fiable, aligné avec VeilleSource schéma) ; (b) fallback 0.5 (neutre, aligné avec `getReliability`). **Recommandation** : garder 85 (logique de l'admin UI story 2-1 : champ requis, défaut 85). Documenter dans JSDoc.

**[F09] `sourceReliabilityCache.ts:31-55` — pas de TTL ni de mutex concurrent** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/sourceReliabilityCache.ts:31-55`
- Detail: si `loadReliabilityMap` est appelée 2× en parallèle, 2 lectures Firestore. Pas de cache module-level. Pour scope actuel (50 sources, scan quotidien), non-problème. Mais le commentaire JSDoc dit "le caller est responsable du TTL".
- Fix: **DEFER** à story 2-4 (orchestrateur) où le caller sera implémenté. Ajouter une note dans le JSDoc pour clarifier.

**[F10] `keywords.ts:50,98` — `RegExp` allouée par appel (perf micro)** 🟡low-medium
- Source: Blind Hunter
- Location: `src/server/veille/keywords.ts:73-74, 98`
- Detail: `buildWordBoundaryRegex` crée un nouveau `RegExp` par keyword court × article. Pour 8 short keywords × 50 articles = 400 regex/scan. Allocations négligeables (< 1ms total).
- Fix: **DISMISS** — perf largement sous le budget (3ms/50 articles mesuré). Optimisation prématurée.

**[F11] `keywords.ts:95` — `SHORT_KEYWORDS` global, ignore le paramètre `keywords`** 🟡medium
- Source: Blind Hunter
- Location: `src/server/veille/keywords.ts:95`
- Detail: `SHORT_KEYWORDS` est calculé une fois au module-load sur `SIRH_IA_KEYWORDS` (constante module). Si un caller passe un autre `keywords` array avec mots courts, ils ne recevront PAS le word-boundary (tomberont en substring). C'est un **leak d'API** : le helper expose une API qui dépend d'un état global.
- Fix: **PATCH** : recalculer SHORT_KEYWORDS à chaque appel `countKeywordMatches(keywords)` à partir du paramètre (et non de la constante module). Coût : O(n) une fois par article (n = 41). Négligeable.

**[F12] `keywords.ts:62` — regex `/[̀-ͯ]/g` (Combining Diacritics) fragile** 🟡medium
- Source: Blind Hunter + Edge Case Hunter
- Location: `src/server/veille/keywords.ts:62-64`
- Detail: caractères U+0300-U+036F dans une regex char-class. Fonctionne en V8 mais peut être mal encodé par certains bundlers (esbuild, webpack). Pas de pré-composé pour `œ`/`æ`/`ø` (qui ne décomposent pas en NFD).
- Fix: **PATCH** : remplacer par `/\p{Diacritic}/gu` (Unicode property, plus portable), OU par `̀-ͯ` (escape explicite). Pour `œ`/`æ`/`ø`, ajouter manuellement `replace(/œ/g, "oe").replace(/æ/g, "ae")` (hors scope, aucun mot-clé actuel concerné).

**[F13] `keywords.ts:62` — NFD ne décompose pas `œ`/`æ`/`ø`** 🟡high (latent)
- Source: Edge Case Hunter
- Location: `src/server/veille/keywords.ts:59-65`
- Detail: les caractères pré-composés `œ` (U+0153), `æ` (U+00E6) ne sont pas décomposés par `String.normalize("NFD")`. Si un futur keyword contient `œ` (ex: "cœur de projet"), il ne matchera pas la version ASCII.
- Fix: **DEFER** (aucun mot-clé actuel n'utilise ces caractères). Documenter la limitation.

**[F14] `scripts/test-scorer.ts:193` — top-level await sans wrapper async** 🟡high
- Source: Blind Hunter
- Location: `scripts/test-scorer.ts:193`
- Detail: `await loadReliabilityMap()` au top-level d'un script `.ts`. `tsx` supporte top-level await en mode ESM, mais le fichier n'est pas explicitement ESM (package.json a `"type": "module"` ✓), donc OK. **Mais** : si tsconfig `module: "commonjs"` (à vérifier), throw SyntaxError.
- Fix: **PATCH** : wrapper dans une `async function main()` appelée en bas de fichier. Plus robuste.

**[F15] `scripts/test-scorer.ts:194` — test mode dégradé non-portable** 🟡medium
- Source: Blind Hunter
- Location: `scripts/test-scorer.ts:191-195`
- Detail: le test suppose `loadReliabilityMap()` retourne Map vide (Firestore indispo). Vrai en env AI Studio sans credentials. Faux en dev local avec credentials configurées → test FAIL.
- Fix: **PATCH** : mocker `getAdminDb` pour forcer le mode dégradé. OU wrapper dans `try { m = await ...; } catch { m = new Map(); }` et tester l'un OU l'autre.

**[F16] `scripts/test-scorer-pure.ts:39-181` — duplique toute la logique de production** 🟡medium
- Source: Blind Hunter
- Location: `scripts/test-scorer-pure.ts`
- Detail: le "test pur" ré-implémente `SHORT_KEYWORDS`, `normalizeText`, `buildWordBoundaryRegex`, `countKeywordMatches`, `countPromoMarkers`, `computeKeywordDensity`, `computeRecency`, `computeAntiPromo`, `scoreArticle`. Si production dérive, le test passe silencieusement. Le commentaire header dit "Replay logique pure pour valider les ACs critiques en l'absence de node_modules" — c'est un **test fixture**, pas un test de prod.
- Fix: **DECISION NEEDED** : (a) renommer en `scripts/scorer-logic-fixture.ts` (clarifier le rôle), (b) supprimer après validation (one-shot), (c) garder comme référence algorithmique. **Recommandation** : renommer en `*fixture*` (transparence) + ajouter un test qui import la prod (test-scorer.ts).

#### 🟢 LOW (cosmétique / doc)

**[F17] `scorer.ts:97` — rampe linéaire démarre à 24h, pas à 0** 🟢low
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:97`
- Detail: `1 - (ageHours - 24) / (RECENCY_WINDOW_HOURS - 24)`. Cliff à 24h+0.001s (drops below 1.0). Acceptable (spec dit "≤ 24h → 1.0"), pas un bug.
- Fix: **DISMISS** — comportement attendu.

**[F18] `scorer.ts:166` — `promoScore > 40` strict, `promoScore === 40` passe** 🟢low
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:166`
- Detail: 40 = 1.6 markers (impossible avec markers.length * 25), donc le boundary n'est jamais atteint en pratique. Note documentaire.
- Fix: **DISMISS** — non-actionnable.

**[F19] `scorer.ts:193` — `round1(0.85) = 0.9` (floating point)** 🟢low
- Source: Blind Hunter
- Location: `src/server/veille/scorer.ts:43-45`
- Detail: `Math.round(0.85 * 10) / 10 = Math.round(8.5) / 10 = 9 / 10 = 0.9` (banker's rounding? Non, ES spec = away from zero, donc 9). `round1(0.85) === 0.9`, pas 0.85. Les tests utilisent `< 0.01` tolerance, donc masqué.
- Fix: **PATCH** : `Math.round(n * 10 + Number.EPSILON) / 10` pour gérer les .5 ambiguus. Ou documenter "round1 peut dévier de ±0.1 sur les .5 boundary".

**[F20] `sourceReliabilityCache.ts:73` — `cache.get(...) ?? 0` redondant** 🟢low
- Source: Blind Hunter
- Location: `src/server/veillance/sourceReliabilityCache.ts:73`
- Detail: `cache.has()` déjà checké ligne 72, donc `cache.get` ne retourne jamais undefined. Le `?? 0` est mort. **Note** : cela devient utile SI on drop le `cache.has()` (perf micro).
- Fix: **DISMISS** — code defensif acceptable.

**[F21] `types.ts:142` — JSDoc `ScoreComponents.recency` dit "0.0 si date absente", code retourne 0.5** 🟢low
- Source: Blind Hunter
- Location: `src/server/veille/types.ts:140-142`
- Detail: doc/code mismatch. Code correct, JSDoc faux.
- Fix: **PATCH** : corriger JSDoc → "0.5 si date absente ou invalide".

**[F22] `types.ts:142` — `0.0 si >7j` (correct), `0.0 si futur` (correct), `0.5 si null` (code OK, JSDoc faux)** — doublon F21.

**[F23] `scripts/test-scorer.ts:62` — opérateur précedence `Date.now() - 1 * 60 * 60 * 1000`** 🟢low
- Source: Blind Hunter
- Location: `scripts/test-scorer.ts:62, 92, 135, 178`
- Detail: `- 1 * 60 * 60 * 1000` = `- 3600000` (l'opérateur `-` est ambigü : unaire sur `1*60*60*1000` ou binaire `Date.now() - 1` ?). Visuellement trompeur.
- Fix: **PATCH** (cosmétique) : parens `Date.now() - (1 * 60 * 60 * 1000)`.

**[F24] `sourceReliabilityCache.ts:31-55` — pas de pagination, max 10k sources non-borné** 🟢low
- Source: Edge Case Hunter
- Location: `src/server/veille/sourceReliabilityCache.ts:39`
- Detail: pour scope actuel (≤ 50 sources), non-problème. Future-proofing.
- Fix: **DEFER** (hors scope).

**[F25] `scorer.ts:131` — `scoreArticle` ne prend pas `now: Date` en paramètre** 🟢low
- Source: Edge Case Hunter
- Location: `src/server/veille/scorer.ts:131-204`
- Detail: `computeRecency(publishedAt, now: Date)` est testable avec horloge fixe, mais `scoreArticle` appelle `new Date()` en interne. Consistance intra-batch impossible à garantir.
- Fix: **DECISION NEEDED** : (a) ajouter `now: Date = new Date()` en paramètre (testabilité, détermisme), (b) garder en interne (simplicité). **Recommandation** : ajouter le paramètre default. Patch léger.

**[F26] `scorer.ts:166-181` — branche de rejet retourne `components` calculés** 🟢low
- Source: Edge Case Hunter
- Location: `src/server/veille/scorer.ts:166-181`
- Detail: sémantiquement ambigu (rejeté mais components remplis). Caller doit vérifier `rejected` avant d'utiliser `score`.
- Fix: **DISMISS** — design intentionnel (audit possible du pourquoi-rejet via components).

**[F27] `types.ts:155` — `score: number` sans branded type** 🟢low
- Source: Edge Case Hunter
- Location: `src/server/veille/types.ts:155`
- Detail: TS ne peut pas garantir `[0, 100]` sans branded type. Hors scope.
- Fix: **DISMISS** — runtime validation via `clamp` suffit.

**[F28] `sourceReliabilityCache.ts:18` — import inutilisé `DEFAULT_RELIABILITY_MEDIUM`** 🟢low
- Source: Blind Hunter (implicite, code review)
- Location: `src/server/veille/sourceReliabilityCache.ts:18`
- Detail: importé ligne 18, jamais utilisé (seul `DEFAULT_RELIABILITY_HIGH` est utilisé ligne 44).
- Fix: **PATCH** : retirer l'import inutilisé.

**[F29] `types.ts:124-131` — ScorableArticle accepte n'importe quel string pour `publishedAt`** 🟢low
- Source: Blind Hunter
- Location: `src/server/veille/types.ts:128`
- Detail: pas de runtime validation. `Date.parse` peut retourner NaN. Caller responsibility.
- Fix: **DISMISS** — TS type-level suffit, `computeRecency` gère NaN.

**[F30] `sourceReliabilityCache.ts:42` — `data.reliabilityScore === null` retourne DEFAULT_HIGH (cohérent)** 🟢low
- Source: Edge Case Hunter (implicite)
- Location: `src/server/veillance/sourceReliabilityCache.ts:42`
- Detail: `typeof null === "object"` → false → fallback. Comportement attendu.
- Fix: **DISMISS**.

**[F31] `scripts/test-scorer-pure.ts` — `Any types` dans le replay `scoreArticle`** 🟢low
- Source: Blind Hunter
- Location: `scripts/test-scorer-pure.ts:167`
- Detail: le replay utilise `any` pour le type `article`. Perd la type-safety du test.
- Fix: **DISMISS** — fixture de validation algorithmique, types importés augmenteraient la dépendance.

### Findings AC-only (Acceptance Auditor, 2 deviations)

**[F32] AC #3 — formula deviation** ⚠️
- Source: Acceptance Auditor
- Detail: `total / (2 * |KEYWORDS|)` vs spec `countMatches / max(countMatches, TOTAL_KEYWORDS)`. **Non équivalent**. La formule spec sature à 1.0 dès que tous les keywords matchent au moins 1 fois. La formule impl ajoute un bonus x2 pour title presence. Les deux sont mathématiquement valides, pas équivalentes.
- **DECISION NEEDED** : (a) aligner sur spec (simplifier le code, perdre le bonus title), (b) mettre à jour AC #3 (accepter la formule actuelle, documenter le bonus). **Recommandation** : (b) — la formule actuelle est plus discriminante.

**[F33] AC #4 — schema deviation (`reliable: boolean` vs `reliabilityScore: 0-100`)** ⚠️
- Source: Acceptance Auditor
- Detail: utilise `VeilleSource.reliabilityScore: number` (existe dans `src/types/veille.ts:29`), pas `reliable: boolean` (champs spec incorrect). **Déjà documenté** dans Dev Notes.
- **DECISION NEEDED** : accepter la deviation. **Recommandation** : accepter (le schéma actuel est plus granulaire que le binaire spec). Documenter dans la spec pour les stories futures.

## Statistiques triage

| Bucket | Count | % |
|--------|-------|---|
| 🔴 Patch (high/critical) | 4 | 12% |
| 🟡 Patch (medium) | 6 | 18% |
| 🟡 Patch (low-medium) | 1 | 3% |
| 🟢 Dismiss | 8 | 24% |
| ⏸ Defer | 2 | 6% |
| ❓ Decision needed | 4 | 12% |
| ⚠️ AC deviation (decision) | 2 | 6% |
| **Total findings bruts** | **33** | 100% |
| **Patches actionnables (sans décision)** | **11** | 33% |
| **Décisions user** | **6** | 18% |

## Plan d'application proposé

**Décisions à confirmer avant patch** :
1. [F01+F02] Word-boundary pour tous les keywords + markers promo (vs substring actuel) ?
2. [F04] Forcer `score: 0` pour `textContent` vide (vs laisser 60 pile) ?
3. [F08] Fallback 85 vs 0.5 pour champ `reliabilityScore` absent ?
4. [F16] Renommer `test-scorer-pure.ts` en `*fixture*` ou supprimer ?
5. [F32] Aligner AC #3 sur spec, ou mettre à jour l'AC pour la formule actuelle ?
6. [F33] Accepter la deviation AC #4 (`reliabilityScore: 0-100` au lieu de `reliable: boolean`) ?

**Patches automatiques (si décisions OK)** :
- F03 (NaN guard) — patch obligatoire
- F11 (SHORT_KEYWORDS leak) — patch recommandé
- F12 (regex Unicode) — patch recommandé
- F14 (top-level await wrapper) — patch obligatoire
- F15 (test portable) — patch recommandé
- F19 (round1 floating point) — patch cosmétique
- F21 (JSDoc recency) — patch obligatoire (doc/code mismatch)
- F23 (operator precedence) — patch cosmétique
- F25 (now parameter) — patch recommandé
- F28 (import inutilisé) — patch obligatoire

**Defer** : F09 (mutex cache → 2-4), F13 (œ/æ → futur), F24 (pagination → futur).

**Dismiss** : F05, F10, F17, F18, F20, F26, F27, F29, F30, F31.
