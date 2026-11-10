import type * as Y from 'yjs';

import type { RepairMode } from './document-store.js';

/** Settings for a new Yjs document store. */
export interface YjsDocumentStoreOptions {
  /** Optional deterministic unsigned 32-bit client id; distinct for every writer of one board. */
  readonly clientId?: number;
  /** Automatic repairs write by default; viewers can project them without changing history. */
  readonly repairMode?: RepairMode;
}

/**
 * Assigns a deterministic client id when supplied.
 *
 * @param doc - The new store's document.
 * @param clientId - An optional unsigned 32-bit id.
 * @throws {RangeError} When the supplied id is not an unsigned 32-bit integer.
 */
export function assignClientId(doc: Y.Doc, clientId: number | undefined): void {
  if (clientId === undefined) return;
  if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xff_ff_ff_ff) {
    throw new RangeError(`A client id is an unsigned 32-bit integer, got ${String(clientId)}`);
  }
  doc.clientID = clientId;
}
