---
project_name: 'prisme'
spec_slug: 'veille-automatique'
date: '2026-06-03'
version: '1.0'
source_spec: '_bmad-output/specs/spec-veille-automatique/SPEC.md'
status: draft
generated_by: 'bmad-sprint-planning'
---

# Epics & Stories — Veille Automatique SIRH/IA

_Ces epics sont dérivés de la spec v1.1 verrouillée. Chaque epic regroupe une ou plusieurs capabilities (CAP-N) et est découpé en stories BDD-ready._

**Contraintes globales héritées de la spec :**
- C0 Zéro hallucination
- C1 Sources publiques uniquement
- C2 Pas de LLM pour générer des faits
- C3 Français uniquement
- C4 Offline-first
- C5 Admin gate préservé (`christof.thomas@gmail.com` ou email contenant "admin")
- C6 Rétrocompatibilité VeilleReport (passage 7 → 5 actualités)

**Stack imposée :** `fast-xml-parser`, `@mozilla/readability`, `natural`, Gemini `gemini-3.5-flash`, Firestore, `node-cron`, Express.

---

## Epic 1 : Configuration des sources de veille

**Capability source :** CAP-1
**Intention :** Permettre à l'admin de définir, persister et administrer les sources alimentant le pipeline de veille.
**Valeur métier :** Sortir du pipeline simulé ; l'admin garde le contrôle des sources sans modifier le code.

### Story 1.1 : Modèle de données VeilleSource et collection Firestore

**User Story :** En tant qu'admin, je veux que le schéma `VeilleSource` soit défini et stocké dans Firestore, afin que les sources soient persistées et partageables entre sessions.

**Critères d'acceptation (BDD) :**
- **Étant donné que** l'admin ouvre PRISME pour la première fois
- **Quand** la collection `veille_sources` est initialisée
- **Alors** elle contient les 9 sources RSS primaires du fichier `sources-donnees.md` avec `active: true` par défaut sauf indication contraire
- **Et** chaque document respecte le schéma TypeScript `VeilleSource` (id, name, url, type, apiKeyEnvVar?, keywords[], categories[], active, lastScanAt, scanFrequency, reliabilityScore)
- **Et** `firestore.rules` autorise la lecture pour tous les utilisateurs authentifiés et l'écriture uniquement si `request.auth.token.email` matche le pattern admin

**Notes techniques :**
- Schéma dans `src/types/veille.ts` (nouveau fichier)
- Collection racine : `veille_sources`
- Index Firestore sur `active` + `scanFrequency` pour le worker cron

---

### Story 1.2 : UI admin de gestion des sources

**User Story :** En tant qu'admin, je veux voir, activer/désactiver et éditer les sources depuis l'UI PRISME, afin de piloter la veille sans toucher au code.

**Critères d'acceptation :**
- **Étant donné que** l'admin est connecté
- **Quand** il accède à la section "Sources" de PRISME
- **Alors** il voit la liste des sources avec nom, type, état actif/inactif, dernière date de scan
- **Et** il peut basculer l'état actif via un toggle
- **Et** il peut éditer `keywords`, `categories`, `scanFrequency`, `reliabilityScore` via un formulaire
- **Et** les non-admins ne voient pas cette section (C5)

**Notes techniques :**
- Nouveau composant `src/components/admin/SourceManager.tsx`
- Intégration dans `App.tsx` via onglet conditionnel sur `isAdmin`
- Pas de nouveau routeur (SPA existante)

---

### Story 1.3 : Persistance et synchronisation temps réel

**User Story :** En tant qu'admin, je veux que mes modifications de sources soient sauvegardées dans Firestore et synchronisées en temps réel, afin de ne pas perdre de configuration.

**Critères d'acceptation :**
- **Étant donné que** l'admin modifie une source
- **Quand** il valide le formulaire
- **Alors** la modification est écrite dans Firestore via `setDoc`
- **Et** un listener `onSnapshot` met à jour l'UI locale
- **Et** le pattern de debounce 1.2s du projet est respecté
- **Et** en cas d'erreur Firestore, un fallback `localStorage` permet de conserver la modif hors-ligne (C4)

**Notes techniques :**
- Réutiliser le pattern de sync `App.tsx` (debounce + `useRef` `isSyncingRef`)
- Hook custom possible : `useVeilleSources()` dans `src/hooks/`

---

## Epic 2 : Pipeline de scan, scoring et structuration

**Capabilities sources :** CAP-2, CAP-3, CAP-4, CAP-5
**Intention :** Implémenter le moteur de bout-en-bout : scan des sources, extraction, scoring, classification 5 catégories, citation vérifiable.
**Valeur métier :** Produire des rapports sans hallucination à partir de sources primaires.

### Story 2.1 : Worker de scan périodique configurable

**User Story :** En tant qu'admin, je veux que le pipeline scanne automatiquement les sources selon la fréquence configurée, afin d'avoir un flux d'articles frais sans intervention manuelle.

**Critères d'acceptation :**
- **Étant donné que** des sources actives existent avec `scanFrequency` défini
- **Quand** le cron configuré se déclenche (par défaut dimanche 23h30, override via env)
- **Alors** chaque source active est interrogée selon son type (RSS / sitemap / API)
- **Et** le User-Agent est `PRISME-Bot/1.0`
- **Et** le timeout par requête est 3500ms
- **Et** le rate limit est 1 req/sec par domaine
- **Et** seuls les articles datés de la semaine courante sont retenus
- **Et** les dédoublonnages par URL canonical sont appliqués

**Notes techniques :**
- Service `src/server/veille/scanner.ts`
- Réutiliser `node-cron` existant
- Fréquence configurable : `daily` | `weekly` | `custom` (expression CRON dans doc Firestore)

---

### Story 2.2 : Extraction de contenu article

**User Story :** En tant que système, je veux extraire le texte principal d'un article depuis son URL, afin de le soumettre au scoring et au résumé.

**Critères d'acceptation :**
- **Étant donné qu'** un article provient d'un sitemap ou d'une API
- **Quand** l'extraction est lancée
- **Alors** `@mozilla/readability` parse le HTML et retourne le contenu textuel principal
- **Et** pour les sources RSS, le `<description>` / `content:encoded` est utilisé directement
- **Et** les articles dont l'extraction échoue sont journalisés et exclus

**Notes techniques :**
- Service `src/server/veille/extractor.ts`
- Ajouter dépendances : `fast-xml-parser`, `@mozilla/readability`

---

### Story 2.3 : Scoring de pertinence composite

**User Story :** En tant que système, je veux attribuer un score 0-100 à chaque article, afin de ne garder que les contenus pertinents au domaine SIRH/IA.

**Critères d'acceptation :**
- **Étant donné qu'** un article brut est extrait
- **Quand** le scoring s'exécute
- **Alors** le score est calculé : `(keywordDensity * 40) + (sourceReliability * 30) + (recency * 20) + (antiPromo * 10)`
- **Et** le seuil d'inclusion est `score >= 60`
- **Et** les articles avec `promoScore > 40` sont rejetés (liste noire de marqueurs)
- **Et** la liste des mots-clés SIRH/IA est externalisée (config)

**Notes techniques :**
- Service `src/server/veille/scorer.ts`
- Lib `natural` pour TF-IDF
- Liste mots-clés dans `src/server/veille/keywords.ts`
- Liste noire promo : "nous proposons", "contactez-nous", "demandez une démo", "solution clé en main", "gratuit", "offre limitée"

---

### Story 2.4 : Stockage temporaire Firestore avec TTL

**User Story :** En tant que système, je veux stocker les articles bruts et scorés dans Firestore avec une rétention de 7 jours, afin de servir de tampon entre scan et génération du rapport.

**Critères d'acceptation :**
- **Étant donné qu'** un article est extrait et scoré
- **Quand** il est persisté
- **Alors** un document est créé dans `veille_raw_articles` avec `extractedAt = now`
- **Et** un TTL de 7 jours est appliqué (champ `expiresAt`)
- **Et** un job de purge quotidien supprime les documents expirés

**Notes techniques :**
- Collection : `veille_raw_articles`
- Index : `score` desc, `expiresAt` asc

---

### Story 2.5 : Structuration en 5 catégories métier (Gemini)

**User Story :** En tant qu'admin, je veux que les articles filtrés soient classifiés en Top 5, Tendances, Mouvements, Risques réglementaires, Recommandations HRC, afin d'obtenir un rapport structuré selon le format PRISME.

**Critères d'acceptation :**
- **Étant donné qu'** un corpus d'articles scorés >= 60 est disponible
- **Quand** la structuration s'exécute
- **Alors** Gemini `gemini-3.5-flash` classe chaque article dans une des 5 catégories
- **Et** le prompt contraint interdit au LLM d'inventer des faits (C2) — il reçoit uniquement le texte extrait + catégorie
- **Et** un JSON strict est retourné conforme au schéma `StructuredVeilleReport`
- **Et** si moins de 5 articles atteignent le seuil, le Top 5 est raccourci sans fallback créatif (C0)

**Notes techniques :**
- Service `src/server/veille/structurer.ts`
- Réutiliser le pattern `responseSchema` de `server.ts:generateWeeklyAutoReport`
- Schéma : `top3`[3] (legacy compat), `actualites`[5] (C6), `mouvements`, `reglementation`, `signalFaible`, `chiffre`, `actions`

---

### Story 2.6 : Citation vérifiable et log d'audit

**User Story :** En tant que lecteur du rapport, je veux que chaque information citée porte une URL source vérifiable, afin de garantir zéro hallucination.

**Critères d'acceptation :**
- **Étant donné qu'** un rapport structuré est généré
- **Quand** la validation des citations s'exécute
- **Alors** chaque article retenu porte son URL source exacte
- **Et** toute actualité sans URL est exclue automatiquement
- **Et** les sources rejetées (score < 60 ou non vérifiables) sont journalisées dans `veille_audit_log`
- **Et** le log contient : articleId, reason, rejectedAt, score

**Notes techniques :**
- Service `src/server/veille/auditor.ts`
- Collection : `veille_audit_log`
- C0 = contrat dur : pas de fallback créatif

---

## Epic 3 : Intégration au flux de rapport existant

**Capability source :** CAP-6
**Intention :** Brancher le pipeline sur le composant `VeilleReport` de `App.tsx` sans casser l'UI actuelle.
**Valeur métier :** Rendre visibles les rapports vérifiés dans PRISME et retirer la simulation.

### Story 3.1 : Endpoint API de récupération du rapport hebdomadaire

**User Story :** En tant que frontend, je veux un endpoint qui retourne le dernier rapport structuré généré, afin d'afficher la semaine courante.

**Critères d'acceptation :**
- **Étant donné qu'** un rapport est persisté dans Firestore
- **Quand** le frontend appelle `GET /api/veille/latest`
- **Alors** le dernier rapport est retourné au format `VeilleReport`
- **Et** le rapport est cachable 5 minutes (cf. Success Signal spec)
- **Et** le format reste rétrocompatible : 5 actualités (au lieu de 7 legacy) + tous les autres champs

**Notes techniques :**
- Route : `GET /api/veille/latest`
- Handler : `src/server/veille/routes.ts`
- Doc Firestore : `reports/{weekId}` (réutiliser structure existante)

---

### Story 3.2 : Déclenchement manuel admin "Forcer le scan"

**User Story :** En tant qu'admin, je veux déclencher un scan manuel depuis l'UI, afin de tester le pipeline sans attendre le cron.

**Critères d'acceptation :**
- **Étant donné que** l'admin est connecté
- **Quand** il clique sur "Forcer le scan" dans la section admin
- **Alors** `POST /api/veille/auto-generate` est appelé
- **Et** le scan + scoring + structuration s'exécutent de manière synchrone ou asynchrone avec retour de jobId
- **Et** l'UI affiche un état d'avancement (idle / scanning / scoring / done)
- **Et** un rapport est généré et apparaît dans le sélecteur de semaines

**Notes techniques :**
- Réutiliser `POST /api/veille/auto-generate` existant
- Ajouter un état UI de progression (polling ou WebSocket simple)

---

### Story 3.3 : Rendu UI des rapports réels et désactivation simulation

**User Story :** En tant qu'utilisateur, je veux voir les rapports vérifiés dans l'UI PRISME, et ne plus voir de simulation quand la clé Gemini est présente.

**Critères d'acceptation :**
- **Étant donné qu'** un rapport réel est disponible en Firestore
- **Quand** l'utilisateur charge PRISME
- **Alors** le rapport s'affiche dans le composant `VeilleReport` existant
- **Et** le sélecteur de semaines fonctionne comme avant
- **Et** `generateWeeklyAutoReport` ne retourne plus de données simulées quand `GEMINI_API_KEY` est défini
- **Et** le flag `simulated: true` est réservé au mode sans clé

**Notes techniques :**
- `src/App.tsx` — adapter le rendu pour 5 actualités au lieu de 7
- `server.ts` — retirer le fallback simulation quand clé présente
- Conserver rétrocompat 7 actualités si d'anciens rapports sont chargés

---

### Story 3.4 : Cron hebdo configurable et migration des rapports existants

**User Story :** En tant qu'admin, je veux que la fréquence de scan soit configurable (daily/weekly/custom CRON) et que les rapports existants restent accessibles.

**Critères d'acceptation :**
- **Étant donné que** l'admin a configuré `scanFrequency = daily` sur une source
- **Quand** le cron s'exécute
- **Alors** la source est scannée chaque jour à l'heure configurée
- **Et** le rapport hebdo est généré le dimanche 23h30 par défaut
- **Et** les rapports legacy (7 actualités) sont migrés ou taggés `legacy: true` pour rétrocompat UI
- **Et** un CRON custom est accepté si valide (validation expression)

**Notes techniques :**
- `node-cron` scheduler dans `server.ts`
- Helper `validateCronExpression()` (lib `cron-parser` ou regex simple)
- Tag `legacy: true` sur docs `reports/*` antérieurs

---

## Notes transverses

### Dépendances à ajouter (cf. stack.md)
```
fast-xml-parser: ^4.x
@mozilla/readability: ^0.x
natural: ^7.x
```

### Risques identifiés
- **CAP-6 / C6** : passage 7 → 5 actualités = breaking change UI. À mitiger via `legacy: true` flag.
- **CAP-3** : TF-IDF maison vs `natural` — `natural` plus rapide à intégrer, performance suffisante pour ~100 articles/semaine.
- **CAP-2** : rate limiting 1 req/sec peut ralentir un scan complet (~9 sources = 9 sec minimum).

### Hors scope (non-goals)
- NG-1 Pas de crawling profond (SPA JS)
- NG-2 Pas de fact-checking humain
- NG-3 Pas de chiffres fantaisistes
- NG-4 Pas de modification gamification
