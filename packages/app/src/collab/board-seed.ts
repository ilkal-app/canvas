import { isStampedDocument, type YjsDocumentStore } from '@canvas/document';

import { createDemoBoard } from '../engine/demo-board.js';
import { writeBoard } from '../engine/demo-document.js';

/**
 * Seeds a board with the demo board if it has never been written: no objects and no metadata
 * stamp. Every store stamps the document before its first write, so a board whose
 * objects someone deleted is empty but stamped, and stays empty. The demo board's ids and times
 * are its own, so two replicas seeding at once write the same objects. Main thread.
 *
 * @param store - The board's store, once what it holds (the relay's board, the cached copy) is
 *   in it.
 * @returns Whether it was seeded.
 */
export function seedIfNeverWritten(store: YjsDocumentStore): boolean {
  if (store.read().objects.size > 0 || isStampedDocument(store)) return false;
  writeBoard(store, createDemoBoard());
  return true;
}
