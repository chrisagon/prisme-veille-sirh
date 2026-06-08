---
project_name: 'prisme'
user_name: 'Christophe'
date: '2026-06-08'
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - code_quality_rules
  - workflow_rules
  - dont_miss_rules
  - deployment
  - security
status: complete
rule_count: 28
optimized_for_llm: true
existing_patterns_found: 10
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

| Layer | Tech | Version |
|-------|------|---------|
| Language | TypeScript | ~5.8.2 |
| Frontend | React | 19.0.1 |
| Build | Vite | 6.2.3 |
| CSS | Tailwind CSS | 4.1.14 |
| Backend | Express.js | 4.21.2 |
| AI | **Perplexity Sonar Deep Research** via OpenRouter (SDK `openai`, base `https://openrouter.ai/api/v1`, model `perplexity/sonar-deep-research`) |
| Auth/DB | Firebase | 12.13.0 (Auth + Firestore, client + Admin SDK) |
| Email | Nodemailer | 8.0.9 (OVH SMTP `ssl0.ovh.net:465`) |
| Scheduling | `node-cron` | 4.2.1 |
| Security | `helmet` ^8.0.0, `express-rate-limit` ^7.4.0 | CSP disabled, rate limit sur `/api/veille/*` (5/min) et `/api/newsletter/send` (10/min) |
| Content extraction | JSDOM + `@mozilla/readability`, `sanitize-html` ^2.13.0 | — |
| UI/Animations | `lucide-react`, `motion` (Framer Motion) | — |
| Dev runner | `tsx` | 4.21.0 |
| Server bundler | `esbuild` | 0.25.0 |
| Deploy | Google Cloud Run | Node 20-bookworm-slim, multi-stage Dockerfile |
| Repository | GitHub | https://github.com/chrisagon/prisme-veille-sirh (public) |

**Migration récente** : Gemini (modèle `gemini-3.5-flash`) → Perplexity Sonar Deep Research. `geminiClient.ts` supprimé, remplacé par `src/server/veille/perplexityClient.ts`. Fichier `geminiClient.ts` n'existe plus — toute mention dans le code est obsolète.

---

## Critical Implementation Rules

### Language-Specific Rules (TypeScript)

- `jsx: "react-jsx"` in `tsconfig.json` — **do NOT import React** explicitly.
- `moduleResolution: "bundler"`, `isolatedModules: true` — each file must be self-contained.
- `allowImportingTsExtensions: true` + `noEmit: true` — TS is type-check only; Vite/esbuild handle transpilation.
- `experimentalDecorators: true`, `useDefineForClassFields: false` — legacy compat mode active.
- Path alias `@/*` resolves to **project root** (`./*`), NOT `src/`.
- Legacy `any` types exist in `App.tsx`. Prefer `unknown` for new code; refactor `any` when touching adjacent code.
- Use `FormEvent` from React for form handlers, not raw `Event`.
- `engines.node >= 18` dans `package.json`. Cloud Run utilise Node 20-bookworm-slim.

### Framework-Specific Rules

- **Monolithic frontend**: all UI, state, auth, gamification, quiz, newsletter logic lives in `src/App.tsx` (~3,100 lines). Extract new components into `src/components/`.
- **No routing library** — pure SPA with conditional state rendering.
- **No external state management** — `useState`/`useEffect` + `localStorage` only.
- **Offline-first persistence**: `localStorage` caches everything; Firestore syncs when authenticated. Debounce 1.2s. Never break the `localStorage` fallback.
- **Hooks patterns**: `useRef` for sync flags (e.g., `isSyncingRef`), `useEffect` for bidirectional sync logic.
- **Express routes**: all API endpoints under `/api/*`. Routes with security (helmet + rate-limit + body cap) are documented dans `CLAUDE.md` section "Backend".
- **Vite HMR toggle**: env `DISABLE_HMR=true` disables HMR and file watching. Honor this when editing files via agent.
- **Perplexity schema strict**: `VeilleReport` doit contenir exactement **7** `actualites`; chaque item doit avoir `source` et `url` non-vides. `response_format: json_schema` enforced via OpenRouter.

### Server-Side Pipeline (veille/)

Le pipeline de scan est **server-side uniquement** (Admin SDK bypass les rules) :

```
veille_sources/         (admin-curated)
  ↓ scanner.ts          (filtre keywords/catégories, cron dimanche 23:30)
veille_raw_articles/    (TTL 7j, Admin SDK write)
  ↓ structurer.ts       (Perplexity → 5 catégories)
reports/{id}            (Admin SDK write)
  ↓ auditor.ts          (citation vérifiable)
veille_audit_log/{id}   (immutable, Admin SDK only)
```

Code : `src/server/veille/{scanner,fetch,extractor,structurer,persistence,auditor,perplexityClient}.ts`. Shims : `src/server/firestoreCompat.ts`, `src/server/firebaseAdmin.ts`.

### Testing Rules

- **No test framework installed.** No test conventions exist.
- `package.json` has no test command. Adding tests later starts from zero — no legacy constraints.

### Code Quality & Style Rules

- **No ESLint, no Prettier configured.** `npm run lint` = `tsc --noEmit` only.
- **Naming**: components in PascalCase (`App.tsx`), data/util files in camelCase/kebab-case.
- **Tailwind v4 custom theme**: brand colors `hr-navy` (#004F71) and `hr-green` (#6DB326) in `src/index.css` via `@theme` block.
- **Utility classes**: `no-print` hides elements in print media; `glow-card` adds top gradient border.
- **French language throughout**: all UI strings, API prompts, and response content must be in French.

### Development Workflow Rules

| Command | Behavior |
|---------|----------|
| `npm run dev` | `tsx server.ts` — dev server, port 3000 par défaut, overridé par `PORT` env |
| `npm run build` | Vite client build + esbuild server bundle → `dist/server.cjs` |
| `npm run start` | `node dist/server.cjs` — production (lit `process.env.PORT`/`HOST`) |
| `npm run lint` | `tsc --noEmit` only |
| `npm run clean` | `rm -rf dist server.js` (bash; not cross-platform) |

- `NODE_ENV=production` switches Vite from dev middleware to static `dist/` serving.
- `DISABLE_HMR=true` disables HMR + file watching (AI Studio agent edit mode).
- **Server must honor `process.env.PORT` and `process.env.HOST`** (Cloud Run injects them). Hardcoded `3000` = instance killed on deploy.

### Deployment Rules

- **Target** : Google Cloud Run, region `europe-west1`, project `gen-lang-client-0186458517`.
- **Build** : `gcloud run deploy prisme --source .` (Cloud Build implicite).
- **Dockerfile** : multi-stage, Node 20-bookworm-slim, user non-root uid 1001, HEALTHCHECK sur `/`.
- **Secrets** : 4 secrets GCP Secret Manager — `openrouter-api-key`, `smtp-user`, `smtp-pass`, `firebase-service-account` — bindés au compute SA `890682109421-compute@developer.gserviceaccount.com`.
- **Provisioning** : `scripts/setup-secrets.sh` (idempotent, lit `.env.local` gitignored ou stdin).
- **Cost** : ~0-5$/mois (scaling to zero).
- **Cron** : `node-cron` dimanche 23:30 dans l'instance. Recommandation future : migrer vers Cloud Scheduler (reliability > cost).
- **Deploy doc** : `DEPLOY-CLOUD-RUN.md`.

### Security Rules

- **Helmet** actif avec `contentSecurityPolicy: false` (Vite dev compatibility). À réactiver avec nonce-based CSP en prod sans rebuild Vite.
- **Rate limiting** sur endpoints sensibles (cf. table dans `CLAUDE.md`). Ne pas retirer sans raison.
- **Body cap 1MB** sur tous les endpoints (`express.json({ limit: "1mb" })`).
- **URL scheme allowlist** : helper `safeHref()` bloque `javascript:` / `data:` dans `<a href>`. Toujours utiliser ce helper pour les `href` dynamiques.
- **Admin gate** : exact match `christof.thomas@gmail.com`. Le regex `.*admin.*` a été supprimé (auth bypass). Le substring check client-side dans `App.tsx` est aligné (garder synchro).
- **`rawText` / `customInstructions` cap** : 64KB / 8KB sur `/api/veille/generate` (anti-prompt-injection). Validation au début de la route.
- **Firestore rules** : user profile validation stricte. `isOwner(userId)` pour writes sur `users/{uid}`. `isAdminEmail()` = exact match.
- **Admin SDK** : utilisé **uniquement** côté serveur (`src/server/*`). Jamais dans le client.

### Critical Don't-Miss Rules

- **Admin gate hardcoded** in `src/App.tsx`: only `christof.thomas@gmail.com` sees edit/generate/cron controls. Update hardcoded check if expanding admin pool.
- **Simulation fallback**: if `OPENROUTER_API_KEY` missing, server returns pre-canned report with `simulated: true`. Same for SMTP without credentials. Preserves `simulated` flag in responses.
- **Cron job**: auto-generates report every Sunday at 23:30 (`30 23 * * 0`).
- **Perplexity strict schema**: `VeilleReport` must contain exactly **7** `actualites`; each must have non-empty `source` and `url` fields.
- **Gamification scoring formula** (do NOT change without data migration):
  - Actions completed: +50
  - Lessons completed: +40
  - Resources read: +25
  - Quiz completed: +100 + (score × 50)
  - Base: 120 pts
- **Firestore rules** enforce strict user profile schema (uid, email, streak, list sizes ≤ 200). Writes failing validation are rejected.
- **Cloud Run PORT**: `process.env.PORT || 3000` dans `server.ts`. Ne jamais hardcoder `3000` sans fallback.
- **`firebase-applet-config.json`** est requis au build time par `src/lib/firebase.ts`. Le Dockerfile le copie. Ne pas ajouter à `.gitignore`.
- **`FIREBASE_SERVICE_ACCOUNT_JSON`** est parsé par `JSON.parse` dans `src/server/firebaseAdmin.ts`. Le JSON est injecté via Secret Manager → env var Cloud Run. Ne pas essayer de lire comme fichier.
