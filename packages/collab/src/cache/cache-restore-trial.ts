import * as Y from 'yjs';

import {
  DOCUMENT_LAYOUT_VERSION,
  DocumentVersionError,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type DocumentStore,
} from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { CacheRestoreVersionError } from './cache-restore-version-error.js';
import type { CachedBoard } from './document-cache.js';
import { isTrustedStamp, snapshotDigest, type SnapshotStamp } from './snapshot-stamp.js';

/**
 * Whether a cached board may be restored without the trial store: a snapshot with a
 * stamp that vouches for exactly its bytes (`isTrustedStamp`) and no tail after it. A tail
 * always needs the trial: its objects' writers may be stamped only in the snapshot's metadata.
 *
 * @param cached - The cached board.
 * @returns True when the snapshot is trusted and nothing follows it.
 */
export function isTrustedSnapshot(cached: CachedBoard): boolean {
  return (
    cached.snapshot !== undefined &&
    cached.updates.length === 0 &&
    isTrustedStamp(cached.snapshotStamp, cached.snapshot)
  );
}

/**
 * Proves a cached board readable in an isolated read-only store before it touches the real one:
 * a layout or schema refusal there leaves the real store clean.
 *
 * @param store - The binding's store, whose state the trial starts from; not changed.
 * @param cached - The cached board.
 * @throws {CacheRestoreVersionError} When the cache names a layout or schema this build cannot
 *   read, or holds unversioned writers.
 */
export function proveReadable(store: DocumentStore, cached: CachedBoard): void {
  const trial = new YjsDocumentStore({ repairMode: 'read-only' });
  try {
    trial.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
    try {
      if (cached.snapshot !== undefined) trial.applyUpdate(cached.snapshot, SYSTEM_ORIGIN);
      if (cached.updates.length > 0)
        trial.applyUpdate(Y.mergeUpdates([...cached.updates]), SYSTEM_ORIGIN);
    } catch (error: unknown) {
      if (error instanceof DocumentVersionError) throw new CacheRestoreVersionError(error);
      throw error;
    }
  } finally {
    trial.destroy();
  }
}

/**
 * The stamp a snapshot is compacted with: its digest and this build's layout and schema
 * versions, from a store that reads its board; none from a store refusing it, whose snapshot a
 * reopen must prove in the trial store again.
 *
 * @param store - The store the snapshot was encoded from.
 * @param snapshot - The snapshot bytes about to be stored.
 * @returns The stamp, or undefined.
 */
export function stampFor(store: DocumentStore, snapshot: Uint8Array): SnapshotStamp | undefined {
  if (store.versionError !== undefined) return undefined;
  return {
    digest: snapshotDigest(snapshot),
    layoutVersion: DOCUMENT_LAYOUT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}
