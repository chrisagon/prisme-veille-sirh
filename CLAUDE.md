# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PRISME** — Plateforme de veille stratégique hebdomadaire sur l'IA et les SIRH (Systèmes d'Information Ressources Humaines). Application monolingue française. Générée initialement via AI Studio puis enrichie itérativement.

**Tech stack**: React 19 + Vite 6 + Tailwind CSS 4 + Express.js + TypeScript. AI via Perplexity Sonar Deep Research (`openai` SDK, modèle `perplexity/sonar-deep-research` via OpenRouter). Auth/DB via Firebase (Auth + Firestore). Email via Nodemailer/SMTP OVH. Scheduling via `node-cron`. Déployé sur **Google Cloud Run** (région `europe-west1`).

**Repository**: https://github.com/chrisagon/prisme-veille-sirh (public)

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (`tsx server.ts`, port 3000 par défaut, overridé par `PORT` env) |
| `npm run build` | Production build: Vite client + esbuild server bundle to `dist/server.cjs` |
| `npm run start` | Run production server (`node dist/server.cjs`) |
| `npm run lint` | Type-check only: `tsc --noEmit`. No ESLint configured. |
| `npm run clean` | Delete `dist/` and `server.js` |

**No test framework is installed.** No Prettier config.

## Environment Variables

Required in `.env.local` (see `.env.example`):
- `OPENROUTER_API_KEY` — OpenRouter API key for Perplexity Sonar Deep Research. If missing, the app runs in "rich simulation mode" with pre-canned reports.
- `SMTP_USER` / `SMTP_PASS` — OVH SMTP credentials. Newsletter simulates success if absent.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — JSON complet du compte Admin SDK (mode prod) OU `FIREBASE_SERVICE_ACCOUNT_FILE` pointant le fichier. Lue par `src/server/firebaseAdmin.ts`.

Optional:
- `NODE_ENV=production` — Switches Vite from dev middleware to static `dist/` serving. **Obligatoire** en prod Cloud Run.
- `DISABLE_HMR=true` — Disables HMR and file watching (used by AI Studio during agent edits).
- `PORT` / `HOST` — Cloud Run injecte `PORT=8080` et attend que l'app écoute dessus. Défauts : 3000 / `0.0.0.0`.

## Architecture

### Monolithic Single-File Frontend

The entire UI lives in **`src/App.tsx`** (~3,100 lines). It contains all state, auth logic, gamification, quiz engine, report editor, newsletter UI, print logic, and Firebase sync. **No routing library.** No external state management (pure `useState`/`useEffect` + `localStorage`). Extracting components from `App.tsx` is the primary refactoring axis.

### Data Model: `VeilleReport`

Each weekly report (`src/data/defaultReports.ts`) is a rigidly structured object:
- `top3`: string[3] — highlights
- `actualites`: 7 news items with `title`, `source`, `date`, `summary`, `impact`, `tags`, `url`
- `mouvements`: market moves (partnerships, acquisitions, features)
- `reglementation`: IA Act / CNIL / RGPD updates
- `chiffre`: statistic of the week
- `signalFaible`: emerging trend
- `ressources`: reading materials
- `actions`: recommended action items

The Perplexity generation endpoint (`POST /api/veille/generate`) enforces this schema strictly via `response_format: json_schema`. The prompt and schema are both in French.

### Pipeline Veille (server-side, stories 2-1 à 2-6)

- `src/server/veille/scanner.ts` — worker de scan périodique (lit `veille_sources`, applique filtres mots-clés / catégories)
- `src/server/veille/fetch.ts` — fetch HTTP avec streaming 5MB cap, redirect limit, sanitize-html
- `src/server/veille/extractor.ts` — extraction contenu via JSDOM + @mozilla/readability
- `src/server/veille/structurer.ts` — structuration en 5 catégories métier via Perplexity Sonar Deep Research
- `src/server/veille/persistence.ts` — écriture Firestore (admin SDK, bypass rules) avec `writeBatch`
- `src/server/veille/auditor.ts` — citation vérifiable + log d'audit (`veille_audit_log/{id}`)
- `src/server/veille/perplexityClient.ts` — singleton client OpenRouter
- `src/server/firestoreCompat.ts` — shim Admin SDK pour les helpers communs
- `src/server/firebaseAdmin.ts` — init Admin SDK, lit `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON.parse) ou `GOOGLE_APPLICATION_CREDENTIALS` (file)

### Auth & Persistence

- **Firebase Auth**: email/password + Google Sign-In popup.
- **Offline-first**: `localStorage` caches reports, gamification progress, and newsletter settings. Firestore syncs when a user is authenticated.
- **Firestore sync**: Debounced 1.2s on every state change. User profile stored under `users/{uid}`, reports under `reports/{id}`.
- **Admin gate**: Only `christof.thomas@gmail.com` (hardcoded in `src/App.tsx`, exact match) sees edit/generate/cron controls. The previous `.*admin.*` regex was removed during security hardening.

### Backend (`server.ts`)

Express server. Endpoints with their security protections:

| Endpoint | Method | Protection |
|---|---|---|
| `/api/veille/generate` | POST | helmet, `llmLimiter` 5/min, body cap 1MB, `rawText` cap 64KB, `customInstructions` cap 8KB |
| `/api/veille/auto-generate` | GET | `llmLimiter` 5/min, planifié par `node-cron` dimanche 23:30 |
| `/api/rss-stats` | POST | helmet, body cap |
| `/api/newsletter/send` | POST | `smtpLimiter` 10/min, Nodemailer OVH (simulation si creds absentes) |

- `app.use(helmet({ contentSecurityPolicy: false }))` — CSP désactivée pour Vite dev. À réactiver en prod avec nonce-based CSP.
- `app.use(express.json({ limit: "1mb" }))` — body cap sur tous les endpoints.

### Gamification System

Embedded entirely in `App.tsx`:
- Point scoring: Actions (+50), Lessons (+40), Resources (+25), Quizzes (+100 + score bonus)
- 4 levels: Novice → Explorateur → Praticien Éthique → Expert Conseil SIRH
- 5 badges (`badgesList`)
- Leaderboard: hybrid — real Firestore users mixed with fake demo players when < 3 real users

### Build Notes

- `vite.config.ts` disables HMR when `DISABLE_HMR=true` to prevent flicker during agent file edits.
- Tailwind CSS v4 uses `@import "tailwindcss"` and `@theme` blocks in `src/index.css`. Custom brand colors: `--color-hr-navy`, `--color-hr-green`.
- `tsconfig.json` path alias: `@/*` maps to `./*` (project root).
- `firebase-applet-config.json` (clés Firebase Web publiques) est requis par `src/lib/firebase.ts` au build time → copié dans le Dockerfile.

## Deployment

- **Cible** : Google Cloud Run, région `europe-west1`, projet GCP `gen-lang-client-0186458517`
- **Build** : multi-stage Dockerfile (Node 20-bookworm-slim, user non-root uid 1001)
- **Trigger** : `gcloud run deploy prisme --source .` (Cloud Build implicite)
- **Secrets** : 4 secrets dans GCP Secret Manager (openrouter-api-key, smtp-user, smtp-pass, firebase-service-account) — bindés au compute SA via `setup-secrets.sh`
- **Coûts estimés** : ~0-5$/mois (scaling to zero, gratuit si peu de trafic)
- **Cron** : `node-cron` dimanche 23:30 dans l'instance. Recommandation : migrer vers Cloud Scheduler pour reliability (cf. `DEPLOY-CLOUD-RUN.md`)

Documentation complète : [`DEPLOY-CLOUD-RUN.md`](DEPLOY-CLOUD-RUN.md)
Provisioning des secrets : [`scripts/setup-secrets.sh`](scripts/setup-secrets.sh)

## Security

Top 6 fixes appliqués (commit `2cf2d5a`) :
1. **Helmet** ajouté (CSP désactivée pour Vite, à réactiver)
2. **Rate limiting** : `express-rate-limit` sur `/api/veille/*` (5/min) et `/api/newsletter/send` (10/min)
3. **Body cap** : `express.json({ limit: "1mb" })` + URL-encoded idem
4. **URL scheme allowlist** : helper `safeHref()` bloque `javascript:`/`data:` dans `<a href>`
5. **Admin gate** : suppression du regex `.*admin.*` (auth bypass), exact match sur `christof.thomas@gmail.com` côté Firestore rules
6. **`rawText` / `customInstructions` cap** : 64KB / 8KB sur `/api/veille/generate` (anti-prompt-injection)

Findings restants (à traiter en suivi, non bloquants) :
- Firestore rules `isSignedIn()` → durcir en `isOwner(userId)` pour `reports/`
- `parseGeminiResponse` validation côté serveur avant retour client
- CSP nonce-based à activer
- Helmet `referrerPolicy: 'no-referrer'` à ajouter

## Key Files

| File | Role |
|------|------|
| `server.ts` | Express API, Perplexity proxy (OpenRouter), RSS counts, newsletter, cron |
| `Dockerfile` | Multi-stage Cloud Run build (Node 20-bookworm-slim) |
| `.dockerignore` | Exclut node_modules, secrets, _bmad, .claude du build context |
| `DEPLOY-CLOUD-RUN.md` | Guide de déploiement complet |
| `scripts/setup-secrets.sh` | Provisioning idempotent des 4 secrets GCP |
| `src/App.tsx` | Monolithic React component (all UI + state + logic) |
| `src/data/defaultReports.ts` | `VeilleReport` type + hardcoded weekly reports |
| `src/server/veille/` | Pipeline veille : scanner, fetch, extractor, structurer, persistence, auditor |
| `src/server/firebaseAdmin.ts` | Init Admin SDK (lit `FIREBASE_SERVICE_ACCOUNT_JSON`) |
| `src/lib/firebase.ts` | Firebase init, auth helpers, Firestore error handling |
| `vite.config.ts` | Vite + React + Tailwind plugins, HMR env toggle |
| `firestore.rules` | Security rules with user profile validation |
| `index.html` | Entry HTML (lang="fr") |
