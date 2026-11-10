import * as Y from 'yjs';

/**
 * Encodes integrated history and pending deletes for relay admission. Unresolved structs stay
 * in the source document and its persistence encoding, ready for their missing dependencies.
 *
 * Yjs 13.6.33's encodeStateAsUpdate/writeStateAsUpdate read only doc.store. This encoding-only
 * view shares integrated structs and pending deletes but omits pending structs. It never
 * mutates the live store, even during nested encoding or an exception. The version contract
 * test requires re-reading this dependency before upgrading Yjs. Never persist this encoding.
 *
 * @param doc - The document whose full retained state must remain untouched.
 * @param stateVector - The relay's integrated clocks.
 * @returns Update-v1 bytes with no unresolved structs, retaining pending delete sets.
 */
export function encodeSyncState(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  const store = Object.create(doc.store, { pendingStructs: { value: null } }) as Y.Doc['store'];
  const view = Object.create(doc, { store: { value: store } }) as Y.Doc;
  return Y.encodeStateAsUpdate(view, stateVector);
}
