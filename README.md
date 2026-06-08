# PRISME

> **Plateforme de veille stratégique hebdomadaire sur l'IA et les SIRH**
> Application monolingue française — React 19 + Vite 6 + Express + TypeScript

PRISME agrège, structure et restitue chaque semaine les actualités IA & SIRH (Systèmes d'Information Ressources Humaines) avec un pipeline automatisé : scan de sources RSS/sitemap/API → extraction de contenu → structuration en 5 catégories métier → citation vérifiable → diffusion newsletter.

**Stack** : React 19 · Vite 6 · Tailwind CSS 4 · Express 4 · TypeScript · Firebase (Auth + Firestore) · Perplexity Sonar Deep Research via OpenRouter · Nodemailer SMTP (OVH) · node-cron

**Démo** : [prisme-XXX.europe-west1.run.app](https://prisme-809643020983.europe-west1.run.app) *(à mettre à jour avec l'URL Cloud Run prod)*

---

## Quickstart (local)

```bash
git clone https://github.com/chrisagon/prisme-veille-sirh.git
cd prisme-veille-sirh
npm install
cp .env.example .env.local   # éditer avec tes clés
npm run dev                  # http://localhost:3000
```

**Prérequis** : Node.js ≥ 18, npm ≥ 9.

**Mode dégradé** : si `OPENROUTER_API_KEY` est absent, l'app tourne avec des rapports pré-câblés (simulation). Idem pour les credentials SMTP (newsletter simulée).

## Build & production

```bash
npm run build    # Vite client + esbuild server → dist/server.cjs
npm run start    # node dist/server.cjs
```

## Déploiement

Cible : **Google Cloud Run** (région `europe-west1`).

```bash
# 1. Secrets (une seule fois)
./scripts/setup-secrets.sh gen-lang-client-0186458517

# 2. Deploy
gcloud run deploy prisme --source . --region europe-west1 \
  --allow-unauthenticated --port 8080 --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 4 --timeout 300 \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest,SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest,FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account:latest
```

Documentation complète : [`DEPLOY-CLOUD-RUN.md`](DEPLOY-CLOUD-RUN.md)

## Architecture

```
src/
  App.tsx                          # UI monolithique (React)
  data/defaultReports.ts           # type VeilleReport + rapports pré-câblés
  lib/firebase.ts                  # Firebase init (client SDK)
  server/
    firebaseAdmin.ts               # Firebase Admin SDK (server-side)
    firestoreCompat.ts             # shim Admin SDK
    veille/
      scanner.ts                   # scan périodique des sources
      fetch.ts                     # fetch HTTP avec safeguards
      extractor.ts                 # JSDOM + Readability
      structurer.ts                # Perplexity Sonar Deep Research
      persistence.ts               # Firestore writeBatch
      auditor.ts                   # citation vérifiable + log audit
      perplexityClient.ts          # singleton OpenRouter
server.ts                          # Express API + cron
firestore.rules                    # security rules
Dockerfile                         # multi-stage Cloud Run build
```

## Pipeline veille (1 cycle)

1. **Scan** (`scanner.ts`) : lit `veille_sources` actives, applique filtres keywords/catégories
2. **Fetch** (`fetch.ts`) : HTTP GET avec streaming 5MB cap, redirect limit, sanitize-html
3. **Extract** (`extractor.ts`) : JSDOM + @mozilla/readability → texte propre
4. **Score** : scoring composite (pertinence × récence × source reliability)
5. **Structurer** (`structurer.ts`) : Perplexity classe en 5 catégories (Réglementation, Mouvements, Chiffre, Signal faible, Ressources)
6. **Persist** (`persistence.ts`) : `writeBatch` Firestore → `veille_raw_articles/` (TTL 7j)
7. **Audit** (`auditor.ts`) : citation vérifiable + log immutable dans `veille_audit_log/`

## Sécurité

- **Helmet** + **rate-limiting** (`express-rate-limit`) sur tous les endpoints sensibles
- **Body cap** 1MB sur tous les endpoints
- **URL scheme allowlist** (`safeHref()`) contre `javascript:` / `data:` XSS
- **Admin gate** exact match sur `christof.thomas@gmail.com` (plus de regex `.*admin.*`)
- **Validation** des inputs LLM (`rawText` 64KB cap, `customInstructions` 8KB cap)
- **Firestore rules** : user profile validation, isOwner pour users/{uid}
- **Admin SDK** côté serveur uniquement, bypass des rules pour le pipeline veille

## Contribution

1. Fork & clone
2. `npm install`
3. `cp .env.example .env.local` (sans clés réelles pour dev)
4. `npm run dev` → tester sur `localhost:3000`
5. Type-check : `npm run lint`
6. PR avec description claire

## License

Privé — tous droits réservés.

---

🤖 *Initialement généré via [Google AI Studio](https://ai.studio), enrichi itérativement.*
