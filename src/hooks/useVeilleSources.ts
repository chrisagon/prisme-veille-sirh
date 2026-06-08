import { useEffect, useRef, useState, useCallback } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { VeilleSource } from "../types/veille";

const COLLECTION_NAME = "veille_sources";
const LOCAL_STORAGE_KEY = "prisme_veille_sources";
const DEBOUNCE_MS = 1200;
const MAX_PENDING_ATTEMPTS = 3;

const COLLECTION_REF = collection(db, COLLECTION_NAME);

function loadFromLocalStorage(): VeilleSource[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VeilleSource[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(sources: VeilleSource[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sources));
  } catch {
    // localStorage plein ou indisponible — silencieux
  }
}

export type SyncState = "idle" | "syncing" | "error";

export interface UseVeilleSourcesResult {
  sources: VeilleSource[];
  loading: boolean;
  error: Error | null;
  syncState: SyncState;
  upsert: (source: VeilleSource) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  refresh: () => void;
}

interface PendingEntry {
  source: VeilleSource;
  attempts: number;
}

/**
 * Hook React de souscription temps réel à `veille_sources`.
 * - Offline-first : cache `localStorage` (clé `prisme_veille_sources`)
 * - `upsert` debouncé 1.2s avant écriture Firestore
 * - Mutations : localStorage immédiat, Firestore après debounce
 * - Rollback UI sur erreur d'écriture (sauf si nouvelles données arrivent via onSnapshot)
 * - Retry limité à MAX_PENDING_ATTEMPTS pour éviter boucle infinie
 */
export function useVeilleSources(): UseVeilleSourcesResult {
  const [sources, setSources] = useState<VeilleSource[]>(() =>
    loadFromLocalStorage(),
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [retryNonce, setRetryNonce] = useState<number>(0);

  const debounceRef = useRef<number | null>(null);
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());
  const sourcesRef = useRef<Map<string, VeilleSource>>(new Map());

  const flushPending = useCallback(async () => {
    if (pendingRef.current.size === 0) return;
    setSyncState("syncing");
    const pending: Array<[string, PendingEntry]> = [];
    pendingRef.current.forEach((value, key) => {
      pending.push([key, value]);
    });
    for (const [id, entry] of pending) {
      try {
        const ref = doc(db, COLLECTION_NAME, id);
        await setDoc(ref, { ...entry.source, lastScanAt: entry.source.lastScanAt ?? null });
        pendingRef.current.delete(id);
      } catch (err) {
        // Rollback UI : restaurer la valeur précédente capturée avant l'upsert.
        // Si onSnapshot ramène la valeur authoritFirestore entre-temps,
        // sourcesRef.current sera déjà à jour et la convergence reprendra.
        const previous = sourcesRef.current.get(id);
        if (previous) {
          setSources((prev) => {
            const next = prev.map((s) => (s.id === id ? previous : s));
            saveToLocalStorage(next);
            return next;
          });
        }
        if (entry.attempts + 1 >= MAX_PENDING_ATTEMPTS) {
          // Abandon : on ne repousse plus dans pendingRef.
          pendingRef.current.delete(id);
          setSyncState("error");
          handleFirestoreError(err, OperationType.WRITE, `${COLLECTION_NAME}/${id}`);
        } else {
          pendingRef.current.set(id, { source: entry.source, attempts: entry.attempts + 1 });
          setSyncState("error");
          handleFirestoreError(err, OperationType.WRITE, `${COLLECTION_NAME}/${id}`);
        }
      }
    }
    if (pendingRef.current.size === 0 && syncState !== "error") {
      setSyncState("idle");
    }
  }, [syncState]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      COLLECTION_REF,
      (snapshot) => {
        const next: VeilleSource[] = snapshot.docs.map((d) => {
          const data = d.data() as Omit<VeilleSource, "id">;
          return { id: d.id, ...data } as VeilleSource;
        });
        setSources(next);
        saveToLocalStorage(next);
        sourcesRef.current = new Map(next.map((s) => [s.id, s]));
        setLoading(false);
        setError(null);
      },
      (err) => {
        const wrapped = new Error(
          err instanceof Error ? err.message : String(err),
        );
        setError(wrapped);
        setLoading(false);
      },
    );
    return () => {
      unsubscribe();
      // Flush pending mutations avant unmount pour éviter la perte
      // de données si le debounce est en cours.
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (pendingRef.current.size > 0) {
        void flushPending();
      }
    };
  }, [flushPending, retryNonce]);

  const upsert = useCallback(
    (source: VeilleSource) => {
      // 1. localStorage immédiat
      setSources((prev) => {
        const idx = prev.findIndex((s) => s.id === source.id);
        const next =
          idx >= 0
            ? prev.map((s) => (s.id === source.id ? source : s))
            : [...prev, source];
        saveToLocalStorage(next);
        return next;
      });
      // 2. debounce Firestore
      const existing = pendingRef.current.get(source.id);
      const attempts = existing?.attempts ?? 0;
      pendingRef.current.set(source.id, { source, attempts });
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void flushPending();
      }, DEBOUNCE_MS);
    },
    [flushPending],
  );

  const toggle = useCallback(
    (id: string) => {
      // Lit la source depuis `sourcesRef` (toujours à jour via onSnapshot)
      // pour éviter le stale state capturé par `sources` dans la closure.
      const existing = sourcesRef.current.get(id);
      if (!existing) return;
      upsert({ ...existing, active: !existing.active });
    },
    [upsert],
  );

  const remove = useCallback(
    async (id: string) => {
      setSources((prev) => {
        const next = prev.filter((s) => s.id !== id);
        saveToLocalStorage(next);
        return next;
      });
      pendingRef.current.delete(id);
      try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  return { sources, loading, error, syncState, upsert, toggle, remove, refresh };
}

// Ré-export pour usage externe
export { Timestamp };
