# Blind Hunter — Review prompt

**Objectif :** Trouver bugs, anti-patterns, code smells, problèmes de sécurité et d'incohérence dans le diff suivant. Aucune connaissance du projet, du spec ou du contexte — UNIQUEMENT le diff brut.

**Output attendu :** Liste Markdown de findings. Chaque finding :
- Titre une ligne
- Sévérité (High / Medium / Low)
- Fichier + ligne
- Description du problème
- Suggestion de fix

**Diff à reviewer :**

```diff
## FILE: src/types/veille.ts (NEW)
import type { Timestamp } from "firebase/firestore";

export type SourceType = "rss" | "sitemap" | "api";
export type ScanFrequency = "daily" | "weekly" | "custom";

export interface VeilleSource {
  id: string;
  name: string;
  url: string;
  type: SourceType;
  apiKeyEnvVar?: string;
  keywords: string[];
  categories: string[];
  active: boolean;
  lastScanAt: Timestamp | null;
  scanFrequency: ScanFrequency;
  cronExpression?: string;
  reliabilityScore: number;
}

export const DEFAULT_RELIABILITY_HIGH = 85;
export const DEFAULT_RELIABILITY_MEDIUM = 70;
```

```diff
## FILE: src/lib/veilleSeed.ts (NEW)
import { collection, getCountFromServer, writeBatch, doc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import { VeilleSource, DEFAULT_RELIABILITY_HIGH, DEFAULT_RELIABILITY_MEDIUM } from "../types/veille";

export const PRIMARY_RSS_SOURCES: VeilleSource[] = [
  { id: "actuel-rh", name: "ActuEL-RH", url: "https://www.actuel-rh.fr/rss", type: "rss",
    keywords: ["SIRH","RH","recrutement","paie"], categories: ["général","recrutement","paie"],
    active: true, lastScanAt: null, scanFrequency: "weekly", reliabilityScore: DEFAULT_RELIABILITY_HIGH },
  // ... 8 autres sources similaires
  { id: "dares", name: "DARES", url: "https://dares.travail-emploi.gouv.fr/", type: "api", ... }
];

export async function seedVeilleSourcesIfEmpty(): Promise<void> {
  try {
    const colRef = collection(db, "veille_sources");
    const snapshot = await getCountFromServer(colRef);
    if (snapshot.data().count > 0) return;
    const batch = writeBatch(db);
    for (const source of PRIMARY_RSS_SOURCES) {
      const { lastScanAt: _lastScanAt, ...payload } = source;
      void _lastScanAt;
      batch.set(doc(colRef, source.id), payload);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "veille_sources (seed)");
  }
}
```

```diff
## FILE: src/hooks/useVeilleSources.ts (NEW)
import { useEffect, useRef, useState, useCallback } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { VeilleSource } from "../types/veille";

const COLLECTION_NAME = "veille_sources";
const LOCAL_STORAGE_KEY = "prisme_veille_sources";
const DEBOUNCE_MS = 1200;
const COLLECTION_REF = collection(db, COLLECTION_NAME);

function loadFromLocalStorage(): VeilleSource[] { /* try/catch JSON.parse */ }
function saveToLocalStorage(sources: VeilleSource[]): void { /* try/catch setItem */ }

export interface UseVeilleSourcesResult { sources, loading, error, upsert, toggle, remove }

export function useVeilleSources(): UseVeilleSourcesResult {
  const [sources, setSources] = useState<VeilleSource[]>(() => loadFromLocalStorage());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const debounceRef = useRef<number | null>(null);
  const pendingRef = useRef<Map<string, VeilleSource>>(new Map());

  useEffect(() => {
    const unsubscribe = onSnapshot(COLLECTION_REF, (snapshot) => {
      const next: VeilleSource[] = snapshot.docs.map((d) => {
        const data = d.data() as Omit<VeilleSource, "id">;
        return { id: d.id, ...data } as VeilleSource;
      });
      setSources(next);
      saveToLocalStorage(next);
      setLoading(false);
      setError(null);
    }, (err) => { setError(new Error(...)); setLoading(false); });
    return () => unsubscribe();
  }, []);

  const flushPending = useCallback(async () => {
    if (pendingRef.current.size === 0) return;
    const pending: Array<[string, VeilleSource]> = [];
    pendingRef.current.forEach((value, key) => { pending.push([key, value]); });
    pendingRef.current.clear();
    for (const [id, source] of pending) {
      try {
        await setDoc(doc(db, COLLECTION_NAME, id), { ...source, lastScanAt: source.lastScanAt ?? null });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${COLLECTION_NAME}/${id}`);
      }
    }
  }, []);

  const upsert = useCallback((source: VeilleSource) => {
    setSources((prev) => { /* update state + saveToLocalStorage */ return next; });
    pendingRef.current.set(source.id, source);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void flushPending();
    }, DEBOUNCE_MS);
  }, [flushPending]);

  const toggle = useCallback((id: string) => {
    const existing = sources.find((s) => s.id === id);
    if (!existing) return;
    upsert({ ...existing, active: !existing.active });
  }, [sources, upsert]);

  const remove = useCallback(async (id: string) => {
    setSources((prev) => { const next = prev.filter((s) => s.id !== id); saveToLocalStorage(next); return next; });
    pendingRef.current.delete(id);
    try { await deleteDoc(doc(db, COLLECTION_NAME, id)); }
    catch (err) { handleFirestoreError(err, OperationType.DELETE, ...); }
  }, []);

  return { sources, loading, error, upsert, toggle, remove };
}
```

```diff
## FILE: firestore.rules (UPDATE — Ajouts)
+    function isAdminEmail() {
+      return isSignedIn()
+        && (request.auth.token.email == "christof.thomas@gmail.com"
+            || request.auth.token.email.matches(".*admin.*"));
+    }
+    function isValidVeilleSource(data) {
+      return data.id is string && data.id.size() <= 128 && data.id.matches('^[a-zA-Z0-9_\\-]+$')
+        && data.name is string && data.url is string
+        && data.type is string && (data.type == "rss" || data.type == "sitemap" || data.type == "api")
+        && data.keywords is list && data.categories is list
+        && data.active is bool
+        && data.scanFrequency is string && (data.scanFrequency == "daily" || data.scanFrequency == "weekly" || data.scanFrequency == "custom")
+        && data.reliabilityScore is int && data.reliabilityScore >= 0 && data.reliabilityScore <= 100
+        && (!("apiKeyEnvVar" in data) || data.apiKeyEnvVar is string)
+        && (!("cronExpression" in data) || data.cronExpression is string)
+        && (!("lastScanAt" in data) || data.lastScanAt == null || data.lastScanAt is timestamp);
+    }
+    match /veille_sources/{sourceId} {
+      allow read: if isSignedIn();
+      allow create, update: if isAdminEmail() && isValidId(sourceId) && isValidVeilleSource(incoming());
+      allow delete: if isAdminEmail();
+    }
```

```diff
## FILE: firestore.indexes.json (NEW)
{
  "indexes": [
    { "collectionGroup": "veille_sources", "queryScope": "COLLECTION",
      "fields": [ { "fieldPath": "active", "order": "ASCENDING" },
                  { "fieldPath": "scanFrequency", "order": "ASCENDING" } ] },
    { "collectionGroup": "veille_sources", "queryScope": "COLLECTION",
      "fields": [ { "fieldPath": "active", "order": "ASCENDING" },
                  { "fieldPath": "reliabilityScore", "order": "DESCENDING" } ] }
  ],
  "fieldOverrides": []
}
```

**Trouve :** bugs, anti-patterns, code smells, memory leaks, race conditions, type errors, security issues, régressions potentielles, duplications, abstractions manquantes.
