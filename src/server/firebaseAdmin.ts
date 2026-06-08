/**
 * Initialisation Firebase Admin SDK pour le serveur (worker de scan).
 * Cf. _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md (Task 2)
 *
 * - Bypass les Firestore rules (admin SDK)
 * - Lecture des credentials via `GOOGLE_APPLICATION_CREDENTIALS` (path JSON)
 *   ou `FIREBASE_SERVICE_ACCOUNT_JSON` (contenu JSON inline via env)
 * - `ignoreUndefinedProperties: true` pour éviter erreurs sur champs optionnels
 *   `VeilleSource.cronExpression` / `apiKeyEnvVar` (cf. firestore.rules:85-86)
 *
 * Si aucune credentials → log warn, `adminDb` est `null` ; le scanner
 * tournera en mode dégradé (collecte en mémoire, pas de persistance).
 */

import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let _adminDb: Firestore | null = null;
let _initialized = false;

function loadServiceAccount(): unknown | null {
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv && jsonEnv.trim() !== "") {
    try {
      return JSON.parse(jsonEnv) as unknown;
    } catch (err) {
      console.warn(
        "⚠️ [firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON invalide, fallback sur GOOGLE_APPLICATION_CREDENTIALS",
        err,
      );
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return applicationDefault();
  }
  return null;
}

function init(): void {
  if (_initialized) return;
  _initialized = true;

  const creds = loadServiceAccount();
  if (!creds) {
    console.warn(
      "⚠️ [firebaseAdmin] aucune credentials détectée (FIREBASE_SERVICE_ACCOUNT_JSON ni GOOGLE_APPLICATION_CREDENTIALS). Le scanner tournera en mode dégradé.",
    );
    return;
  }

  if (getApps().length === 0) {
    if (creds && typeof creds === "object" && "project_id" in (creds as Record<string, unknown>)) {
      initializeApp({ credential: cert(creds as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({ credential: creds as Parameters<typeof initializeApp>[0]["credential"] });
    }
  }
  _adminDb = getFirestore();
  _adminDb.settings({ ignoreUndefinedProperties: true });
  console.log("✅ [firebaseAdmin] Firebase Admin SDK initialisé");
}

/**
 * Retourne l'instance Firestore Admin.
 * `null` si les credentials sont absentes (mode dégradé).
 */
export function getAdminDb(): Firestore | null {
  if (!_initialized) init();
  return _adminDb;
}

/**
 * Accès direct à l'instance Firestore Admin (throw si non initialisée).
 * Pour usage dans le scanner : préférer `getAdminDb()` + check null.
 */
export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    if (!_initialized) init();
    if (!_adminDb) {
      throw new Error(
        "Firebase Admin SDK non initialisé. Vérifier FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS.",
      );
    }
    return (_adminDb as unknown as Record<string | symbol, unknown>)[prop];
  },
});
