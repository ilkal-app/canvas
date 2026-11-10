import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

/**
 * Opens complete historical bytes in an isolated store with read-only reference projection.
 * No device cache, live store or undo history is involved. The caller owns destruction.
 *
 * @param state - A complete Yjs v1 board state, never a partial transport delta.
 * @returns The isolated readable store; commands remain the caller's responsibility.
 * @throws {Error} If the layout, dependencies or object projection cannot be read completely.
 */
export function openHistoricalStore(state: Uint8Array): YjsDocumentStore {
  const store = new YjsDocumentStore({ repairMode: 'read-only' });
  try {
    store.applyUpdate(state, SYSTEM_ORIGIN);
    const doc = internalsOf(store).doc;
    if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null)
      throw new Error('The historical state has missing dependencies');
    if (store.read().issues.length > 0)
      throw new Error('The historical board has unreadable entries');
    return store;
  } catch (error) {
    store.destroy();
    throw error;
  }
}
