# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PRISME** — Plateforme de veille stratégique hebdomadaire sur l'IA et les SIRH (Systèmes d'Information Ressources Humaines). Application monolingue française. Générée initialement via AI Studio puis enrichie itérativement.

**Tech stack**: React 19 + Vite 6 + Tailwind CSS 4 + Express.js + TypeScript. AI via Perplexity Sonar Deep Research (`openai` SDK, modèle `perplexity/sonar-deep-research` via OpenRouter). Auth/DB via Firebase (Auth + Firestore). Email via Nodemailer/SMTP OVH. Scheduling via `node-cron`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (`tsx server.ts`, port 3000) |
| `npm run build` | Production build: Vite client + esbuild server bundle to `dist/server.cjs` |
| `npm run start` | Run production server (`node dist/server.cjs`) |
| `npm run lint` | Type-check only: `tsc --noEmit`. No ESLint configured. |
| `npm run clean` | Delete `dist/` and `server.js` |

**No test framework is installed.** No Prettier config.

## Environment Variables

Required in `.env.local` (see `.env.example`):
- `OPENROUTER_API_KEY` — OpenRouter API key for Perplexity Sonar Deep Research. If missing, the app runs in "rich simulation mode" with pre-canned reports.
- `SMTP_USER` / `SMTP_PASS` — OVH SMTP credentials. Newsletter simulates success if absent.

Optional:
- `NODE_ENV=production` — Switches Vite from dev middleware to static `dist/` serving.
- `DISABLE_HMR=true` — Disables HMR and file watching (used by AI Studio during agent edits).

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

### Auth & Persistence

- **Firebase Auth**: email/password + Google Sign-In popup.
- **Offline-first**: `localStorage` caches reports, gamification progress, and newsletter settings. Firestore syncs when a user is authenticated.
- **Firestore sync**: Debounced 1.2s on every state change. User profile stored under `users/{uid}`, reports under `reports/{id}`.
- **Admin gate**: Only `christof.thomas@gmail.com` (hardcoded in `src/App.tsx:619`) or emails containing `"admin"` see edit/generate/cron controls. If refactoring admin logic, search for `isAdmin`.

### Backend (`server.ts`)

Express server with four API domains:
1. **`POST /api/veille/generate`** — Perplexity Sonar Deep Research proxy (via OpenRouter). Returns JSON `VeilleReport`. Falls back to keyword-matched simulation if `OPENROUTER_API_KEY` is absent.
2. **`GET /api/veille/auto-generate`** — Admin trigger for forced weekly report generation.
3. **`POST /api/rss-stats`** — Fetches 11 French HR/SIRH RSS feeds, counts `<item>`/`<entry>` tags.
4. **`POST /api/newsletter/send`** — Sends email via Nodemailer (OVH). Returns simulated success if SMTP creds missing.
5. **Cron job**: `node-cron` scheduled every Sunday at 23:30 to auto-generate a report.

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

## Key Files

| File | Role |
|------|------|
| `server.ts` | Express API, Perplexity proxy (OpenRouter), RSS counts, newsletter, cron |
| `src/App.tsx` | Monolithic React component (all UI + state + logic) |
| `src/data/defaultReports.ts` | `VeilleReport` type + hardcoded weekly reports |
| `src/server/veille/perplexityClient.ts` | OpenRouter/Perplexity client singleton (replaces geminiClient.ts) |
| `src/server/veille/structurer.ts` | Report structuring via Perplexity Sonar Deep Research |
| `src/lib/firebase.ts` | Firebase init, auth helpers, Firestore error handling |
| `vite.config.ts` | Vite + React + Tailwind plugins, HMR env toggle |
| `firestore.rules` | Security rules with user profile validation |
| `index.html` | Entry HTML (lang="fr") |
