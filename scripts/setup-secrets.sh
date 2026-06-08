#!/usr/bin/env bash
# Provisionne les 4 secrets PRISME dans GCP Secret Manager
# Usage : ./scripts/setup-secrets.sh [PROJECT_ID]
#   - PROJECT_ID par défaut = variable $GOOGLE_CLOUD_PROJECT ou le projet gcloud actif
#   - Les valeurs sont lues depuis stdin ou .env.local (priorité : stdin > .env.local)
#
# Prérequis : gcloud authentifié, Secret Manager API activée

set -euo pipefail

PROJECT="${1:-${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}}"
if [[ -z "$PROJECT" ]]; then
  echo "ERROR: PROJECT_ID non défini. Usage: $0 PROJECT_ID" >&2
  exit 1
fi

echo "→ Projet GCP : $PROJECT"

# Active Secret Manager API si pas déjà fait
gcloud services enable secretmanager.googleapis.com --project="$PROJECT" 2>/dev/null || true

# Charge .env.local si présent (ignoré par git)
ENV_FILE=".env.local"
if [[ -f "$ENV_FILE" ]]; then
  echo "→ Lecture des secrets depuis $ENV_FILE (gitignored)"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

create_or_update() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    echo "  ⚠ SKIP $name (valeur vide)" >&2
    return 1
  fi

  # Teste si le secret existe déjà
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "  → update $name"
    echo -n "$value" | gcloud secrets versions add "$name" \
      --project="$PROJECT" --data-file=-
  else
    echo "  → create $name"
    echo -n "$value" | gcloud secrets create "$name" \
      --project="$PROJECT" --replication-policy=automatic --data-file=-
  fi
}

# 1. OpenRouter API key
create_or_update "openrouter-api-key" "${OPENROUTER_API_KEY:-}"

# 2. OVH SMTP user
create_or_update "smtp-user" "${SMTP_USER:-}"

# 3. OVH SMTP password
create_or_update "smtp-pass" "${SMTP_PASS:-}"

# 4. Firebase Admin SDK JSON
# Source : fichier pointé par FIREBASE_SERVICE_ACCOUNT_FILE, ou variable
if [[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]]; then
  create_or_update "firebase-service-account" "$FIREBASE_SERVICE_ACCOUNT_JSON"
elif [[ -n "${FIREBASE_SERVICE_ACCOUNT_FILE:-}" && -f "${FIREBASE_SERVICE_ACCOUNT_FILE}" ]]; then
  echo "  → create/update firebase-service-account depuis $FIREBASE_SERVICE_ACCOUNT_FILE"
  if gcloud secrets describe "firebase-service-account" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions add "firebase-service-account" \
      --project="$PROJECT" --data-file="$FIREBASE_SERVICE_ACCOUNT_FILE"
  else
    gcloud secrets create "firebase-service-account" \
      --project="$PROJECT" --replication-policy=automatic \
      --data-file="$FIREBASE_SERVICE_ACCOUNT_FILE"
  fi
else
  echo "  ⚠ SKIP firebase-service-account (ni FIREBASE_SERVICE_ACCOUNT_JSON ni FIREBASE_SERVICE_ACCOUNT_FILE défini)" >&2
fi

# Donne les droits de lecture au runtime service account de Cloud Run
# (compute engine default SA — elle est créée automatiquement au premier deploy)
echo "→ Attribution des rôles secretmanager.secretAccessor au compute SA"
RUNTIME_SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

for SECRET in openrouter-api-key smtp-user smtp-pass firebase-service-account; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --project="$PROJECT" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null 2>&1 || echo "  ⚠ $SECRET: binding déjà existant ou erreur"
done

echo ""
echo "✓ Secrets provisionnés pour $PROJECT"
echo ""
echo "Prochaine étape : gcloud run deploy prisme \\"
echo "  --source . --region europe-west1 --allow-unauthenticated \\"
echo "  --set-secrets=OPENROUTER_API_KEY=openrouter-api-key:latest,SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest,FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account:latest"
