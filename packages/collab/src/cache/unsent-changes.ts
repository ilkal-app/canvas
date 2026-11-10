import * as Y from 'yjs';

import { assertUpdateDepth, type DocumentStore } from '@canvas/document';

import type { CachedBoard } from './document-cache.js';

/** What a cached board holds that a synced store lacks. */
export interface UnsentChanges {
  /**
   * How many cached records (the snapshot, each logged update) hold something the store lacks.
   * A logged update is one transaction, so this counts edits; a compacted snapshot counts once
   * however many edits it folded in.
   */
  readonly count: number;
  /** Those records merged and cut to what the store lacks (Yjs update v1); none when 0. */
  readonly update: Uint8Array | undefined;
}

/** A Yjs delete set; yjs exports the class's factory but not the class. */
type DeleteSet = ReturnType<typeof Y.createDeleteSet>;

/** The part of a store the comparison reads. */
export type SyncedStore = Pick<DocumentStore, 'encodeStateVector' | 'encodeState'>;

/**
 * Tells whether one cached record holds content the store lacks: a struct past the store's
 * state vector, or a deletion the store has not made. A state vector alone misses deletions
 * (deleting writes no new struct), so the store's delete set is compared too.
 *
 * @param record - The cached bytes.
 * @param stateVector - The store's state vector.
 * @param deletions - The store's delete set, merged.
 * @returns Whether the record carries something the store lacks.
 * @throws {Error} When the bytes cannot be read (malformed, or nested past the bound).
 */
function isLacking(record: Uint8Array, stateVector: Uint8Array, deletions: DeleteSet): boolean {
  assertUpdateDepth(record);
  const { structs, ds } = Y.decodeUpdate(Y.diffUpdate(record, stateVector));
  if (structs.some((struct) => !(struct instanceof Y.Skip))) return true;
  return !Y.equalDeleteSets(deletions, Y.mergeDeleteSets([deletions, ds]));
}

/**
 * Works out what a cached board holds that a synced store lacks, client-side: once the relay's
 * step 2 is in the store, the store holds everything the relay has (and whatever the current
 * cache added, which the handshake sends), so whatever the cached board holds beyond the store
 * would otherwise be lost. Encodes the store's state vector and delete set once (an
 * `encodeState` against its own vector, of which only the delete set is read; it includes the
 * store's pending deletions, which its current cache holds), then compares each record. Pure: it
 * never mutates its inputs. Main thread or worker.
 *
 * @param board - The cached board: an earlier writer layout's copy.
 * @param store - The synced store.
 * @returns The count of records holding unsent edits, and those edits as one update.
 * @throws {Error} When a record cannot be read (malformed, or nested past the bound); the
 *   caller keeps the board and reports it.
 */
export function findUnsentChanges(board: CachedBoard, store: SyncedStore): UnsentChanges {
  const stateVector = store.encodeStateVector();
  const deletions = Y.mergeDeleteSets([Y.decodeUpdate(store.encodeState(stateVector)).ds]);
  const records = board.snapshot === undefined ? board.updates : [board.snapshot, ...board.updates];
  const lacking = records.filter((record) => isLacking(record, stateVector, deletions));
  if (lacking.length === 0) return { count: 0, update: undefined };
  return { count: lacking.length, update: Y.diffUpdate(Y.mergeUpdates(lacking), stateVector) };
}
