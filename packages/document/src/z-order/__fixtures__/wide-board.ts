import { createSeededIdGenerator, type ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../../origin/transaction-origin.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { generateObjectKeys } from '../object-keys.js';

import { createSeededRandom } from './seeded-random.js';
import { rectangle } from './sibling-board.js';

// The budget's 50k objects, all children of the board root, written in a shuffled order: the
// widest sibling set the z-order benchmarks sort and plan over.

/** A decoded store of `count` root rectangles, with their ids bottom to top and their keys. */
export interface WideBoard {
  /** The store, already read once so that benchmarks do not pay the first decode. */
  readonly store: YjsDocumentStore;
  /** The ids, bottom to top. */
  readonly ids: readonly ObjectId[];
  /** Every key, in write (shuffled) order. */
  readonly keys: readonly string[];
}

/**
 * Builds the wide board.
 *
 * @param count - How many root rectangles.
 * @returns The board.
 */
export function createWideBoard(count: number): WideBoard {
  const ids = Array.from({ length: count }, createSeededIdGenerator(56));
  const generated = generateObjectKeys(null, null, ids);
  const siblings = createSeededRandom(56).shuffle(
    ids.map((id, index) => ({ id, z: generated[index] ?? 'a0' })),
  );
  const store = new YjsDocumentStore({ clientId: 56 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const { id, z } of siblings) transaction.setObject(rectangle(id, null, z));
  });
  store.read();
  return { store, ids, keys: siblings.map(({ z }) => z) };
}
