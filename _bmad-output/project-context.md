---
project_name: 'prisme'
user_name: 'Christophe'
date: '2026-06-02'
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - code_quality_rules
  - workflow_rules
  - dont_miss_rules
status: complete
rule_count: 23
optimized_for_llm: true
existing_patterns_found: 8
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
| AI | Google Gemini | `@google/genai`, model `gemini-3.5-flash` |
| Auth/DB | Firebase | 12.13.0 (Auth + Firestore) |
| Email | Nodemailer | 8.0.9 (OVH SMTP `ssl0.ovh.net:465`) |
| Scheduling | `node-cron` | 4.2.1 |
| UI/Animations | `lucide-react`, `motion` (Framer Motion) | — |
| Dev runner | `tsx` | 4.21.0 |
| Server bundler | `esbuild` | 0.25.0 |

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

### Framework-Specific Rules

- **Monolithic frontend**: all UI, state, auth, gamification, quiz, newsletter logic lives in `src/App.tsx` (~3,100 lines). Extract new components into `src/components/`.
- **No routing library** — pure SPA with conditional state rendering.
- **No external state management** — `useState`/`useEffect` + `localStorage` only.
- **Offline-first persistence**: `localStorage` caches everything; Firestore syncs when authenticated. Debounce 1.2s. Never break the `localStorage` fallback.
- **Hooks patterns**: `useRef` for sync flags (e.g., `isSyncingRef`), `useEffect` for bidirectional sync logic.
- **Express routes**: all API endpoints under `/api/*`. No custom middleware pattern documented.
- **Vite HMR toggle**: env `DISABLE_HMR=true` disables HMR and file watching. Honor this when editing files via agent.

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
| `npm run dev` | `tsx server.ts` — dev server on port 3000 |
| `npm run build` | Vite client build + esbuild server bundle → `dist/server.cjs` |
| `npm run start` | `node dist/server.cjs` — production |
| `npm run lint` | `tsc --noEmit` only |
| `npm run clean` | `rm -rf dist server.js` (bash; not cross-platform) |

- `NODE_ENV=production` switches Vite from dev middleware to static `dist/` serving.
- `DISABLE_HMR=true` disables HMR + file watching (AI Studio agent edit mode).

### Critical Don't-Miss Rules

- **Admin gate hardcoded** in `src/App.tsx`: only `christof.thomas@gmail.com` or emails containing `"admin"` see edit/generate/cron controls. Update hardcoded check if expanding admin pool.
- **Simulation fallback**: if `GEMINI_API_KEY` missing, server returns pre-canned report with `simulated: true`. Same for SMTP without credentials. Preserves `simulated` flag in responses.
- **Cron job**: auto-generates report every Sunday at 23:30 (`30 23 * * 0`).
- **Gemini strict schema**: `VeilleReport` must contain exactly **7** `actualites`; each must have non-empty `source` and `url` fields.
- **Gamification scoring formula** (do NOT change without data migration):
  - Actions completed: +50
  - Lessons completed: +40
  - Resources read: +25
  - Quiz completed: +100 + (score × 50)
  - Base: 120 pts
- **Firestore rules** enforce strict user profile schema (uid, email, streak, list sizes ≤ 200). Writes failing validation are rejected.
