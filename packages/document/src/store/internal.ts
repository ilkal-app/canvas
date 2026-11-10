import type * as Y from 'yjs';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { LastKnownObjects } from '../repair/last-known-objects.js';

import type { DocumentStore } from './document-store.js';
import type { RunGate, StoreRun } from './store-run.js';
import type { StyleSources } from './style-tables.js';

// Package-internal access to a store's Yjs document, for the undo history (`history/`), which
// drives a `Y.UndoManager` over the objects map and repairs the references its steps leave
// (`repair/`). Not exported from `src/index.ts` (`internal.test.ts` guards this): outside the
// package the document is reached only through the `DocumentStore` interface, so the substrate
// stays replaceable.

/** The Yjs internals of a `YjsDocumentStore`. */
export interface StoreInternals {
  /** The store's document. */
  readonly doc: Y.Doc;
  /** The document's top-level map of objects (`OBJECTS_MAP_NAME`). */
  readonly objects: Y.Map<unknown>;
  /** The document's top-level map of pages (`PAGES_MAP_NAME`). */
  readonly pages: Y.Map<unknown>;
  /** The document's top-level map of colour tokens (`TOKENS_MAP_NAME`). */
  readonly tokens: Y.Map<unknown>;
  /** The document's top-level maps of named styles. */
  readonly styles: StyleSources;
  /** The objects removed from the board, as last seen (`repair/last-known-objects.ts`). */
  readonly lastKnown: LastKnownObjects;
  /**
   * Visible roots to materialize before changing another stored cycle member's placement.
   *
   * @param changed - Placement-changing command ids.
   * @returns Cycle roots in deterministic order.
   */
  readonly cycleRepairs: (changed: ReadonlySet<ObjectId>) => readonly BoardObject[];
  /**
   * Runs the store's reference repair (`repair/reference-repair.ts`) over the given objects in
   * its own transaction with `SYSTEM_ORIGIN`, when anything needs it. Not callable inside a
   * transaction.
   *
   * @param touched - The objects a change created, changed or removed.
   * @param isPagesChanged - Whether the change changed the pages (the page repair, R1).
   * @returns The repaired ids, sorted.
   */
  readonly repairReferences: (
    touched: ReadonlySet<ObjectId>,
    isPagesChanged?: boolean,
  ) => ObjectId[];
  /**
   * Stamps the document under its current Yjs client id when this store has not yet
   * (`DocumentVersionGuard.stampBeforeWrite`). Call inside a store transaction, before a write
   * that bypasses `DocumentTransaction`, such as an undo step's (fix round 1).
   */
  readonly stampBeforeWrite: () => void;
  /**
   * The store's runs: `check` refuses a mutation while another writer's run holds the
   * store (a history's undo and redo call it before they change any of their own state), and
   * its followers are told of each run (`subscribeStoreRuns`).
   */
  readonly runs: RunGate;
  /**
   * Opens a run on the store (`YjsDocumentStore.beginRun`).
   *
   * @returns The run.
   */
  readonly beginRun: () => StoreRun;
}

/** Each live Yjs store's internals, registered by its constructor. */
const registry = new WeakMap<DocumentStore, StoreInternals>();

/**
 * Registers a store's internals; called once, by the `YjsDocumentStore` constructor.
 *
 * @param store - The store.
 * @param internals - Its document and objects map.
 */
export function registerInternals(store: DocumentStore, internals: StoreInternals): void {
  registry.set(store, internals);
}

/**
 * A store's runs, when it is a `YjsDocumentStore`.
 *
 * @param store - The store.
 * @returns Its run gate, or `undefined` for any other store.
 */
export function runsOf(store: DocumentStore): RunGate | undefined {
  return registry.get(store)?.runs;
}

/**
 * Reads a store's Yjs internals. Writes to the document must still go through
 * `store.transact`, so that they carry an origin and keep the store's view current.
 *
 * @param store - A store created by `new YjsDocumentStore()`.
 * @returns Its document and objects map.
 * @throws {TypeError} When the store is not a `YjsDocumentStore`.
 */
export function internalsOf(store: DocumentStore): StoreInternals {
  const internals = registry.get(store);
  if (internals === undefined) {
    throw new TypeError('Undo history needs a YjsDocumentStore; this store has no Yjs document');
  }
  return internals;
}

/**
 * Gets substrate-specific virtual cycle repairs without exposing Yjs to the command layer.
 * Stores without a virtual cycle overlay need no normalization.
 *
 * @param store - The command's document store.
 * @param changed - Placement-changing ids.
 * @returns The roots to materialize, or none for an unregistered substrate.
 */
export function commandCycleRepairs(
  store: DocumentStore,
  changed: ReadonlySet<ObjectId>,
): readonly BoardObject[] {
  return registry.get(store)?.cycleRepairs(changed) ?? [];
}
