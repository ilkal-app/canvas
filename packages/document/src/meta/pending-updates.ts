import type * as Y from 'yjs';

/** Unintegrated fragments removed from a hub; never includes board content. */
export interface DiscardedPendingUpdates {
  /** Bytes of unresolved structs in Yjs update-v2 representation. */
  readonly structBytes: number;
  /** Bytes of unresolved delete sets in Yjs update-v2 representation. */
  readonly deleteBytes: number;
  /** Writer ids whose earlier clocks are missing, with the first missing clock. */
  readonly missing: readonly {
    /** Yjs client id of a writer with unresolved structs. */
    readonly client: number;
    /** Its earliest missing clock. */
    readonly clock: number;
  }[];
}

/**
 * Drops unresolved Yjs structs and delete sets before a relay exposes or checks a loaded hub.
 * Integrated history is untouched. These fragments are not proven safe and cannot later be
 * released by an unrelated update; their original complete client state must be resynced to
 * recover them. This changes only memory, not stored snapshots or logs.
 *
 * @param doc - The hub to clean.
 * @returns Content-free counts and missing clocks for the relay's warning or offline audit.
 */
export function discardPendingUpdates(doc: Y.Doc): DiscardedPendingUpdates {
  const { pendingStructs, pendingDs } = doc.store;
  const discarded = {
    structBytes: pendingStructs?.update.byteLength ?? 0,
    deleteBytes: pendingDs?.byteLength ?? 0,
    missing: [...(pendingStructs?.missing ?? [])].map(([client, clock]) => ({ client, clock })),
  };
  doc.store.pendingStructs = null;
  doc.store.pendingDs = null;
  return discarded;
}
