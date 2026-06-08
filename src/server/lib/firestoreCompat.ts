/**
 * Shim de compatibilité `firestore/compat` pour `firebase-admin@12`.
 *
 * Contexte : `firebase-admin@12` n'expose PLUS les helpers modulaires
 * (`doc`, `setDoc`, `serverTimestamp`, `where`, `query`, `writeBatch`, etc.)
 * via le subpath `firebase-admin/firestore`. Seules les classes
 * (`Firestore`, `Timestamp`, `FieldValue`, `FieldPath`) et initializers
 * (`getFirestore`) sont publics. C'est un changement de design récent.
 *
 * Or le code métier (scanner, persistence, structurer, auditor) utilise
 * massivement l'API modulaire. Plutôt que de réécrire 600 lignes vers
 * l'API orientée objet (`db.collection().doc().set()`), on expose ici
 * des shims fonctionnels qui s'appuient sur l'instance `Firestore` admin
 * retournée par `getAdminDb()`.
 *
 * Pas une réimplémentation : juste un pont vers les méthodes qui existent
 * déjà sur l'instance.
 *
 * Imports à migrer dans le projet :
 *   import { doc, setDoc, ... } from "firebase-admin/firestore";
 *   import { doc, setDoc, ... } from "../../../lib/firestoreCompat";
 *
 * Le code applicatif ne change pas. Seule la source d'import change.
 */

import { Firestore, FieldValue, Timestamp, Query, CollectionReference, DocumentReference, DocumentSnapshot, WriteBatch, QueryDocumentSnapshot, Settings } from "firebase-admin/firestore";

export { FieldValue, Timestamp };
export type { QueryDocumentSnapshot, Firestore, DocumentSnapshot, DocumentReference, CollectionReference, Query, WriteBatch, Settings };

// ============================================================================
// Référence
// ============================================================================

/**
 * Équivalent de `doc(db, collectionPath, ...pathSegments)` du SDK modulaire.
 * `db.doc(path)` est plus court côté admin SDK, mais on garde la signature
 * modulaire pour la compat avec le code existant.
 */
export function doc(
  db: Firestore,
  collectionPath: string,
  ...pathSegments: string[]
): DocumentReference {
  let ref: DocumentReference | CollectionReference = db.collection(collectionPath);
  for (const seg of pathSegments) {
    ref = (ref as CollectionReference).doc(seg);
  }
  return ref as DocumentReference;
}

/** Équivalent de `collection(db, path)`. */
export function collection(db: Firestore, path: string): CollectionReference {
  return db.collection(path);
}

// ============================================================================
// Écriture / lecture
// ============================================================================

export interface SetOptions {
  merge?: boolean;
  mergeFields?: string[] | readonly (string | FieldPath)[];
}

export function setDoc(
  ref: DocumentReference,
  data: Record<string, unknown>,
  options?: SetOptions,
): Promise<void> {
  return ref.set(data as { [key: string]: unknown }, options as unknown as undefined);
}

export function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  return ref.get();
}

/**
 * Équivalent de `updateDoc(ref, data)` du SDK modulaire.
 * `ref.update(data)` côté admin SDK.
 */
export function updateDoc(
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<void> {
  return ref.update(data as { [key: string]: unknown });
}

// ============================================================================
// FieldValue helpers
// ============================================================================

export function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}

export function increment(n: number): FieldValue {
  return FieldValue.increment(n);
}

export function arrayUnion(...elements: unknown[]): FieldValue {
  return FieldValue.arrayUnion(...(elements as Parameters<typeof FieldValue.arrayUnion>));
}

export function arrayRemove(...elements: unknown[]): FieldValue {
  return FieldValue.arrayRemove(...(elements as Parameters<typeof FieldValue.arrayRemove>));
}

export function deleteField(): FieldValue {
  return FieldValue.delete();
}

// ============================================================================
// FieldPath
// ============================================================================

import { FieldPath } from "firebase-admin/firestore";
export { FieldPath };

// ============================================================================
// Query
// ============================================================================

/**
 * `query(collectionRef, ...constraints)` accepte les filtres/orderBy/limit
 * retournés par `where()`, `orderBy()`, `limit()`. C'est juste un wrapper
 * qui retourne la `Query` enrichie. Le code applicatif n'a PAS besoin de
 * `query()` car les méthodes sont chaînables directement, mais on l'expose
 * pour les cas où le code source l'utilise.
 */
export function query(
  ref: CollectionReference | Query,
  ...constraints: Array<(q: Query) => Query>
): Query {
  return constraints.reduce((q, c) => c(q), ref as Query);
}

export function where(
  field: string | FieldPath,
  opStr: "<" | "<=" | "==" | "!=" | ">=" | ">" | "array-contains" | "in" | "not-in" | "array-contains-any",
  value: unknown,
): (q: Query) => Query {
  return (q) => q.where(field, opStr, value);
}

export function orderBy(
  field: string | FieldPath,
  directionStr?: "asc" | "desc",
): (q: Query) => Query {
  return (q) => q.orderBy(field, directionStr);
}

export function limit(n: number): (q: Query) => Query {
  return (q) => q.limit(n);
}

export function startAfter(...values: unknown[]): (q: Query) => Query {
  return (q) => q.startAfter(...(values as Parameters<Query["startAfter"]>));
}

export function startAt(...values: unknown[]): (q: Query) => Query {
  return (q) => q.startAt(...(values as Parameters<Query["startAt"]>));
}

export function endBefore(...values: unknown[]): (q: Query) => Query {
  return (q) => q.endBefore(...(values as Parameters<Query["endBefore"]>));
}

export function endAt(...values: unknown[]): (q: Query) => Query {
  return (q) => q.endAt(...(values as Parameters<Query["endAt"]>));
}

export function getDocs(q: Query): Promise<{ docs: QueryDocumentSnapshot[]; size: number; empty: boolean; forEach: (cb: (d: QueryDocumentSnapshot) => void) => void }> {
  return q.get();
}

// ============================================================================
// Write batch
// ============================================================================

export function writeBatch(db: Firestore): WriteBatch {
  return db.batch();
}

// ============================================================================
// Timestamp helpers
// ============================================================================

export const NOW = "now" as const;
