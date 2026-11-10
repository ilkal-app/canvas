import type * as Y from 'yjs';

/**
 * Counts the structs (items, plus garbage-collected ranges) a Yjs document holds: the figure
 * Yjs's memory follows, about 400 bytes of heap each in V8 (the README's "Yjs at 50k objects").
 *
 * @param doc - The document.
 * @returns The number of structs across every client.
 */
export function countYjsItems(doc: Y.Doc): number {
  let count = 0;
  for (const structs of doc.store.clients.values()) count += structs.length;
  return count;
}
