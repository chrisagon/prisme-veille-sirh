/**
 * Service de tracking des runs de scan (story 3.2 — force-scan admin).
 *
 * Collection Firestore : `veille_scan_runs/{scanId}` (Admin SDK only).
 * Champs : scanId, weekId, startedAt, finishedAt?, status, articlesScanned?,
 *          articlesKept?, errorMessage?.
 * TTL 7 jours via Firestore TTL (à configurer côté console).
 *
 * Mode dégradé (Firestore indispo) : `createScanRun`/`updateScanRun`
 * retournent `null` / no-op sans throw.
 *
 * Pas de throw : tout catch → log warn FR + return safe.
 * Cf. _bmad-output/implementation-artifacts/3-2-declenchement-manuel-admin-forcer-le-scan.md
 */

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "../lib/firestoreCompat";
import { getAdminDb } from "../firebaseAdmin";

const SCAN_RUNS_COLLECTION = "veille_scan_runs";

/** Status possibles d'un scan run. */
export type ScanRunStatus = "running" | "success" | "failed";

export interface ScanRunDoc {
  scanId: string;
  weekId: string;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  status: ScanRunStatus;
  articlesScanned?: number;
  articlesKept?: number;
  errorMessage?: string;
}

/**
 * Crée un doc `veille_scan_runs/{scanId}` avec status="running".
 * Retourne le doc créé (avec Timestamp Firestore) ou `null` si indispo.
 */
export async function createScanRun(
  scanId: string,
  weekId: string,
): Promise<ScanRunDoc | null> {
  const db = getAdminDb();
  if (!db) {
    console.warn(`[scanRuns] Firestore indispo, createScanRun skip (scanId=${scanId})`);
    return null;
  }
  const ref = doc(db, SCAN_RUNS_COLLECTION, scanId);
  const data: ScanRunDoc = {
    scanId,
    weekId,
    startedAt: serverTimestamp() as unknown as Timestamp,
    finishedAt: null,
    status: "running",
  };
  try {
    await setDoc(ref, data);
    console.log(`[scanRuns] créé scanId=${scanId} weekId=${weekId} status=running`);
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scanRuns] createScanRun échoué (scanId=${scanId}) : ${message}`);
    return null;
  }
}

/**
 * Met à jour un scan run existant avec un patch partiel.
 * No-op si le doc n'existe pas (peut arriver si cleanup TTL).
 * No-op si Firestore indispo.
 */
export async function updateScanRun(
  scanId: string,
  partial: Partial<Omit<ScanRunDoc, "scanId" | "startedAt">>,
): Promise<void> {
  const db = getAdminDb();
  if (!db) {
    console.warn(`[scanRuns] Firestore indispo, updateScanRun skip (scanId=${scanId})`);
    return;
  }
  const ref = doc(db, SCAN_RUNS_COLLECTION, scanId);
  try {
    // serverTimestamp() ne peut pas être dans un partial merge simple
    // → on spread manuellement
    const patch: Record<string, unknown> = { ...partial };
    if (partial.finishedAt === undefined && "status" in partial && partial.status !== "running") {
      patch.finishedAt = serverTimestamp();
    }
    await updateDoc(ref, patch);
    console.log(`[scanRuns] update scanId=${scanId} status=${partial.status ?? "unchanged"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scanRuns] updateScanRun échoué (scanId=${scanId}) : ${message}`);
  }
}

/**
 * Lit un scan run par son scanId.
 * Retourne le doc ou `null` (404 équivalent côté client).
 */
export async function getScanRun(scanId: string): Promise<ScanRunDoc | null> {
  const db = getAdminDb();
  if (!db) {
    console.warn(`[scanRuns] Firestore indispo, getScanRun skip (scanId=${scanId})`);
    return null;
  }
  const ref = doc(db, SCAN_RUNS_COLLECTION, scanId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists) return null;
    return snap.data() as ScanRunDoc;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scanRuns] getScanRun échoué (scanId=${scanId}) : ${message}`);
    return null;
  }
}
