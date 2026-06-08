/**
 * Lock in-memory anti-double-trigger pour le force-scan (story 3.2).
 *
 * Le scanner worker (story 2-1) a déjà son propre mutex + lock Firestore.
 * Le force-scan doit aussi éviter qu'un admin clique 2× rapidement et
 * déclenche 2 scans en parallèle (double coût Perplexity).
 *
 * On utilise une Map simple clé = weekId. Cleanup automatique des locks
 * stale (> STALE_LOCK_THRESHOLD_MS sans heartbeat).
 *
 * Ce lock est **in-memory** : si l'instance Cloud Run est redémarrée, le
 * lock est perdu. Mais comme Cloud Run est single-threaded pour une
 * instance donnée (1 process Node), un double-trigger nécessite que
 * l'admin clique 2× dans la même fenêtre de process. Acceptable.
 *
 * Cf. _bmad-output/implementation-artifacts/3-2-declenchement-manuel-admin-forcer-le-scan.md
 */

import { isStaleLock, STALE_LOCK_THRESHOLD_MS } from "./weekId";
import { randomUUID } from "node:crypto";

interface LockEntry {
  scanId: string;
  lastHeartbeat: number;
}

/** Map<weekId, LockEntry> */
const lockMap: Map<string, LockEntry> = new Map();

/**
 * Tente d'acquérir le lock pour un weekId donné.
 * - Si pas de lock ou lock stale → acquire, retourne `{ ok: true, scanId }`
 * - Si lock actif (non stale) → retourne `{ ok: false, existingScanId }`
 */
export function tryAcquireLock(weekId: string, now: number = Date.now()): { ok: boolean; scanId: string; existingScanId?: string } {
  const existing = lockMap.get(weekId);
  if (existing && !isStaleLock(existing.lastHeartbeat, now)) {
    return { ok: false, scanId: "", existingScanId: existing.scanId };
  }
  // Stale lock → on écrase. Log info silencieux.
  if (existing) {
    console.log(`[scanLock] lock stale pour weekId=${weekId} (age=${Math.round((now - existing.lastHeartbeat) / 1000)}s), récupération`);
  }
  const scanId = `force-${randomUUID()}`;
  lockMap.set(weekId, { scanId, lastHeartbeat: now });
  return { ok: true, scanId };
}

/**
 * Met à jour le heartbeat du lock (le scan est toujours en cours).
 * Pas besoin d'appeler toutes les secondes : 1×/min suffit. Le lock
 * est stale après 10 min sans heartbeat.
 */
export function heartbeatLock(weekId: string, now: number = Date.now()): void {
  const entry = lockMap.get(weekId);
  if (entry) {
    entry.lastHeartbeat = now;
  }
}

/**
 * Libère le lock. À appeler quand le scan se termine (succès ou échec).
 */
export function releaseLock(weekId: string): void {
  lockMap.delete(weekId);
}

/**
 * Helper de test : retourne le nombre de locks actifs.
 */
export function _lockSize(): number {
  return lockMap.size;
}

/**
 * Helper de test : vide la map des locks.
 */
export function _clearLocks(): void {
  lockMap.clear();
}

// Re-export pour cohérence d'import
export { STALE_LOCK_THRESHOLD_MS };
