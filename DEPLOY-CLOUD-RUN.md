# Déploiement Cloud Run

## Prérequis

- `gcloud` CLI authentifié sur le projet GCP cible
- Artifact Registry (ou Container Registry) activé dans la région
- API Cloud Run + Cloud Build activées
- Facturation GCP active

## Secrets à provisionner (Secret Manager)

Avant le premier deploy, créer les secrets suivants dans GCP Secret Manager :

```bash
PROJECT=prisme-prod  # ou ton ID de projet GCP

# OpenRouter (Perplexity Sonar Deep Research)
echo -n "sk-or-v1-XXXX" | gcloud secrets create openrouter-api-key \
  --replication-policy=automatic --data-file=-

# OVH SMTP
echo -n "user@ovh.com" | gcloud secrets create smtp-user \
  --replication-policy=automatic --data-file=-
echo -n "password" | gcloud secrets create smtp-pass \
  --replication-policy=automatic --data-file=-

# Firebase Admin SDK (compte de service serveur)
# Télécharger le JSON depuis Firebase Console → Project Settings → Service Accounts
gcloud secrets create firebase-service-account \
  --replication-policy=automatic --data-file=path/to/serviceAccount.json
```

Droits requis sur le runtime service account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com` par défaut) :
- `roles/secretmanager.secretAccessor` sur chaque secret

## Build + Deploy (one-shot)

```bash
gcloud run deploy prisme \
  --source . \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 4 \
  --timeout 300 \
  --concurrency 80 \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest,SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest,FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account:latest
```

Notes :
- `--source .` déclenche un Cloud Build automatique (pas besoin de cloudbuild.yaml)
- `--allow-unauthenticated` : ajuste si tu mets un IAP / Firebase Auth en frontal
- `PORT=8080` est imposé par Cloud Run et mappé sur le port qu'Express écoute
- Le healthcheck `GET /` est requis par Cloud Run et répond 200 (SPA shell)

## Variables d'environnement

| Nom | Type | Source | Notes |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Secret | Secret Manager | Perplexity Sonar Deep Research via OpenRouter |
| `SMTP_USER` | Secret | Secret Manager | OVH user pour newsletter |
| `SMTP_PASS` | Secret | Secret Manager | OVH password |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Secret | Secret Manager | JSON complet du compte de service Admin SDK |
| `NODE_ENV` | Env var | `--set-env-vars` | `production` obligatoire (sinon Vite dev middleware actif) |
| `PORT` | Injecté par Cloud Run | — | 8080 |

Optionnels (mode dégradé si absents) :
- `OPENROUTER_API_KEY` absent → app tourne en "rich simulation mode" (rapports pré-câblés)
- `SMTP_USER`/`SMTP_PASS` absents → newsletter retourne succès simulé

## Lecture des secrets côté serveur

Le code actuel lit `process.env.OPENROUTER_API_KEY`, `process.env.SMTP_USER`, `process.env.SMTP_PASS` directement. Pour `FIREBASE_SERVICE_ACCOUNT_JSON`, le runtime Cloud Run injecte la valeur du secret comme variable d'env contenant le JSON complet. Vérifier que `src/server/firebaseAdmin.ts` parse ce JSON (sinon, charger depuis un fichier monté sur `/var/secrets/...` via `--volume`).

## Domaine custom

```bash
gcloud run domain-mappings create --service prisme --domain prisme.example.com --region europe-west1
```

Puis configurer le DNS (CNAME vers `ghs.googlehosted.com.`).

## Cron job hebdomadaire

Le `node-cron` interne tourne à dimanche 23:30 sur l'instance active. Avec `min-instances=0` et le trafic, l'instance peut être cold-start. Pour garantir l'exécution :

- Option A : `min-instances=1` (coût ~$10/mois pour 512Mi)
- Option B : Cloud Scheduler → HTTP POST sur `/api/veille/auto-generate` (gate admin via `VEILLE_ADMIN_TOKEN`), plus fiable

La migration vers Cloud Scheduler est recommandée (reliability > cost).

## Coûts estimés

- Cloud Run : facturation à la requête. ~0-5$/mois pour trafic modéré (scaling to zero)
- Secret Manager : ~0.06$/secret/mois × 4 = 0.24$/mois
- Artifact Registry : ~0.10$/GB/mois (image finale ~200MB) = 0.02$/mois
- Cloud Build : 120 build-minutes/jour gratuites, largement suffisant

## Rollback

```bash
# Lister les révisions
gcloud run revisions list --service prisme --region europe-west1

# Rollback vers une révision précédente
gcloud run services update-traffic prisme \
  --region europe-west1 \
  --to-revisions=prisme-00007-abc=100
```

## Logs

```bash
gcloud run services logs tail prisme --region europe-west1
```

## Healthcheck

Endpoint : `GET /` (HTTP 200, sert le shell SPA). Le Dockerfile contient un HEALTHCHECK qui sonde ce path toutes les 30s.
