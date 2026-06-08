---
project_name: 'prisme'
spec_slug: 'veille-automatique'
date: '2026-06-02'
status: draft
version: '1.1'
companions: ['sources-donnees.md', 'stack.md']
sources: []
open_questions: []
assumptions:
  - "Le scoring de pertinence est basé sur la densité de mots-clés IA/RH/SIRH dans un article."
  - "Le flux actuel `generateWeeklyAutoReport` (simulation) est entièrement remplacé par le pipeline réel."
  - "Seuil de confiance : une actualité doit être corroborée par au moins 3 sources distinctes pour figurer dans le Top 5."
  - "Fréquence de scan configurable par l'admin : daily, weekly, ou custom (CRON expression)."
  - "Sources payantes hors scope ; remplacées par les posts LinkedIn publics des influents SIRH/IA."
---

# SPEC — Veille Automatique SIRH/IA

## Why

L'application PRISME génère actuellement des rapports hebdomadaires via simulation (données inventées, sources fausses). Cela décrédibilise la plateforme auprès des consultants SIRH qui l'utilisent pour conseiller leurs clients. Il faut un pipeline de veille automatique qui scanne des sources configurées par l'utilisateur, extrait des articles vérifiés, les résume et les structure dans le format métier existant (Top 5, Tendances, Mouvements, Réglementation, Recommandations HRC).

## Capabilities

### [CAP-1] Configuration des sources de veille par l'utilisateur

- **Intent**: L'utilisateur (admin) définit quelles sources alimenteront la veille.
- **Success**: Base de sources persistée (Firestore), chaque source avec `nom`, `url`, `type` (RSS, API, sitemap), `fréquence de scan`, `catégories ciblées`, `actif/inactif`. UI admin intégrée à PRISME (section "Sources").

### [CAP-2] Scan périodique et extraction d'articles

- **Intent**: Le système scanne régulièrement les sources actives et extrait les nouveaux articles pertinents.
- **Success**: Cron hebdomadaire (configurable) déclenche le scan. Chaque source est interrogée selon son type (RSS → parse XML, sitemap → crawl liens, API → call). Seuls les articles datés de la semaine en cours sont retenus. Dédoublonnage par URL canonical. Stockage temporaire des articles bruts en attente de scoring.

### [CAP-3] Scoring de pertinence et filtrage anti-promotionnel

- **Intent**: Classer les articles par pertinence pour le domaine SIRH/IA et écarter le contenu promotionnel.
- **Success**: Chaque article reçoit un score 0-100 basé sur : (a) densité de mots-clés SIRH/IA dans le titre et le corps, (b) présence dans des sources éditoriales reconnues (liste blanche), (c) absence de marqueurs promotionnels ("nous proposons", "contactez-nous", CTA produit). Seuil d'inclusion : score ≥ 60. Articles promotionnels (score promo > 40) rejetés.

### [CAP-4] Structuration en 5 catégories métier

- **Intent**: Transformer les articles filtrés en un rapport structuré selon le format métier PRISME.
- **Success**:
  1. **Top 5 actualités** — 5 articles les plus pertinents, avec `titre`, `date`, `source`, `résumé` (2 lignes).
  2. **Tendances émergentes** — signaux faibles, mouvements de fond, infos à confirmer (articles avec score 50-60 ou sources secondaires).
  3. **Mouvements éditeurs** — M&A, levées de fonds, releases, partenariats (filtrage par tags "marché", "acquisition", "levée").
  4. **Risques réglementaires** — RGPD, IA Act, droit social, jurisprudences (filtres "juridique", "IA Act", "CNIL").
  5. **Recommandations HRC** — 3 actions concrètes déduites des actualités (ex: "Proposer audit IA Act", "Animer webinar transparence").

### [CAP-5] Citation vérifiable des sources — zéro hallucination

- **Intent**: Chaque information citée dans le rapport doit être traçable à une source primaire vérifiable publiquement.
- **Success**:
  - Chaque article résumé porte son URL de source exacte.
  - Si une info ne trouve pas de source corroborante dans le corpus scanné, elle N'EST PAS citée.
  - Si plusieurs sources concordent, toutes sont listées ("d'après ActuEL-RH et Parlons RH").
  - Absence d'URL source = exclusion automatique du rapport.
  - Le backend journalise les sources rejetées (score < 60 ou non vérifiable) dans un log d'audit.

### [CAP-6] Intégration avec le flux de rapport existant

- **Intent**: Le rapport structuré alimente le composant `VeilleReport` existant dans `App.tsx` sans casser le format.
- **Success**: Le pipeline produit un objet `VeilleReport` compatible avec la structure actuelle (`top3`, `actualites`[7 actuellement → 5], `mouvements`, `reglementation`, `signalFaible`, `chiffre`, `ressources`, `actions`). Le rapport est persisté dans Firestore et apparaît dans le sélecteur de semaines de PRISME.

## Constraints

- **Zéro hallucination** — C0. Si une info ne peut être vérifiée par une source scannée, elle n'apparaît pas dans le rapport. Pas de fallback créatif.
- **Sources publiques uniquement** — C1. Écarter les contenus paywallés non accessibles sans API key tierce. Les sources avec API key (ex: NewsAPI, Google News) sont acceptables si l'utilisateur configure sa clé.
- **Pas de LLM pour générer des faits** — C2. Le LLM (Gemini) sert au résumé et à la classification. Il NE génère JAMAIS d'actualités, de chiffres ou de sources sans base textuelle extraite.
- **Français uniquement** — C3. UI, rapports, prompts API, et logs en français.
- **Offline-first** — C4. Le scan backend fonctionne indépendamment du frontend. Le rapport généré est stocké dans Firestore et mis à disposition au prochain chargement de l'app.
- **Admin gate préservé** — C5. Seuls les admins (`christof.thomas@gmail.com` ou email contenant `"admin"`) peuvent configurer les sources et déclencher un scan manuel.
- **Rétrocompatibilité VeilleReport** — C6. La structure `VeilleReport` en base de données reste compatible. Passage de 7 à 5 actualités acceptable si ajusté dans le schéma JSON Gemini et le rendu UI.

## Non-goals

- **NG-1** Pas d'intelligence de crawling profond (JavaScript-rendered SPAs). Les sources doivent exposer du contenu lisible (RSS, sitemap XML, API REST).
- **NG-2** Pas de fact-checking humain. L'audit est automatisé (URL source + corroboration cross-source).
- **NG-3** Pas de génération de chiffres/classements fantaisistes. Le "chiffre de la semaine" est soit extrait d'un article source, soit omis.
- **NG-4** Pas de remplacement du système de gamification existant. Le pipeline alimente les rapports, pas les points/quiz.

## Success Signal

Un rapport hebdomadaire généré automatiquement contient :
- **≥ 5 actualités** avec URL source vérifiable pour chacune.
- **100 % des citations** traçables à une source du corpus scanné (zero hallucination mesurable via log d'audit).
- **Aucun contenu promotionnel** dans les 5 actualités principales.
- **Rapport visible** dans l'UI PRISME dans les 5 minutes suivant la fin du scan automatique.
- **Simulation fallback retirée** — `generateWeeklyAutoReport` ne retourne plus de données inventées quand `GEMINI_API_KEY` est présent.
