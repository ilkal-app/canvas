// The select board (select-board.ts) in a real DocumentStore, for tests that run commands.
import {
  YjsDocumentStore,
  type CommandEnvironment,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import type { SelectionSource } from '../selection-geometry.js';

import { selectBoardObjects } from './select-board.js';

/** The person using the select tool in these tests. */
export const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/** The frozen time commands run at. */
export const NOW = 1_780_000_000_000;

/** A deterministic command environment: frozen clock, and no new ids needed. */
export const ENVIRONMENT: CommandEnvironment = {
  clock: () => NOW,
  createId: () => {
    throw new Error('the select tool creates no objects');
  },
};

/**
 * A store holding the select board, written in one transaction.
 *
 * @param objects - The objects; the select board by default.
 * @returns The store.
 */
export function createSelectStore(
  objects: readonly BoardObject[] = selectBoardObjects(),
): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return store;
}

/**
 * The store as the select tool reads it.
 *
 * @param store - The store.
 * @returns The selection source.
 */
export function storeSource(store: DocumentStore): SelectionSource {
  return {
    get: (id: ObjectId) => store.get(id),
    childrenOf: (id: ObjectId) => store.references.childrenOf(id),
  };
}
