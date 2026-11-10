// Random updates of many clients for the replay's equivalence test: blocks in any
// order whose items name each other's clocks, the document's, or clocks nobody holds, so Yjs
// follows dependencies from client to client, stacks them, and sets stacks aside.
import * as Y from 'yjs';

import type { SeededRandom } from '../../z-order/__fixtures__/seeded-random.js';

import {
  encodeHandUpdate,
  type HandBlock,
  type HandContent,
  type HandItem,
  type HandStruct,
} from './hand-encoded-update.js';

/** One case: a document, an update bound for it, and the replay's work ceiling. */
export interface RandomReplayCase {
  readonly doc: Y.Doc;
  readonly update: Uint8Array;
  readonly maxSteps: number;
}

/** The clients that may already hold structs in the document. */
const HELD_CLIENTS = [101, 102, 103] as const;

/** A client id nobody sends. */
const ABSENT_CLIENT = 999;

/**
 * A document some of {@link HELD_CLIENTS} wrote to: map entries, list values, a deletion.
 *
 * @param random - The seeded choices.
 * @returns The document.
 */
function randomDocument(random: SeededRandom): Y.Doc {
  const doc = new Y.Doc();
  for (const client of HELD_CLIENTS.slice(0, random.below(HELD_CLIENTS.length + 1))) {
    doc.clientID = client;
    doc.transact(() => {
      doc.getMap<number>('objects').set(`k-${String(random.below(3))}`, random.below(9));
      doc.getArray<number>('notes').insert(0, [random.below(9), random.below(9)]);
      if (random.below(3) === 0) doc.getArray<number>('notes').delete(0, 1);
    });
  }
  return doc;
}

/**
 * Ids an item may name: the document's structs, the update's own clocks, and absent ones.
 *
 * @param random - The seeded choices.
 * @param doc - The document.
 * @param clients - The update's clients.
 * @returns The candidates.
 */
function candidateIds(random: SeededRandom, doc: Y.Doc, clients: readonly number[]): Y.ID[] {
  const ids = [Y.createID(ABSENT_CLIENT, random.below(3))];
  for (const client of clients) ids.push(Y.createID(client, random.below(5)));
  for (const structs of doc.store.clients.values()) {
    const struct = random.pick(structs);
    ids.push(Y.createID(struct.id.client, struct.id.clock + random.below(struct.length)));
  }
  return ids;
}

/**
 * A random item: one or two neighbours from the candidates, or a named parent.
 *
 * @param random - The seeded choices.
 * @param ids - The candidates.
 * @returns The item.
 */
function randomItem(random: SeededRandom, ids: readonly Y.ID[]): HandItem {
  const content = random.pick<HandContent>([
    { kind: 'deleted', length: 1 + random.below(2) },
    { kind: 'any', values: [random.below(9)] },
    { kind: 'string', text: 'ab' },
    { kind: 'map' },
  ]);
  const neighbours = random.below(5);
  const origin = neighbours % 2 === 1 ? random.pick(ids) : undefined;
  const rightOrigin = neighbours >= 2 && neighbours < 4 ? random.pick(ids) : undefined;
  if (origin !== undefined && rightOrigin !== undefined) return { origin, rightOrigin, content };
  if (origin !== undefined) return { origin, content };
  if (rightOrigin !== undefined) return { rightOrigin, content };
  if (random.below(3) === 0) return { parent: random.pick(ids), parentSub: 'field', content };
  return random.below(2) === 0
    ? { parent: 'notes', content }
    : { parent: 'objects', parentSub: `k-${String(random.below(3))}`, content };
}

/**
 * A random case: up to twelve clients (some the document holds), each block starting at, below
 * or past the client's state, with skipped and collected ranges; blocks shuffled and now and
 * then one listed twice; a small work ceiling one time in eight.
 *
 * @param random - The seeded choices.
 * @returns The case.
 */
export function randomReplayCase(random: SeededRandom): RandomReplayCase {
  const doc = randomDocument(random);
  const fresh = Array.from({ length: 1 + random.below(10) }, (unused, index) => 200 + index);
  const clients = [...HELD_CLIENTS.slice(0, random.below(4)), ...fresh];
  const ids = candidateIds(random, doc, clients);
  const blocks: HandBlock[] = clients.map((client) => {
    const structs: HandStruct[] = [];
    for (let count = 1 + random.below(4); count > 0; count -= 1) {
      const roll = random.below(12);
      if (roll === 0) structs.push({ skip: 1 + random.below(2) });
      else if (roll === 1) structs.push({ gc: 1 });
      else structs.push(randomItem(random, ids));
    }
    const shift = random.pick([0, 0, 0, 0, -1, 1, 2]);
    return { client, clock: Math.max(0, Y.getState(doc.store, client) + shift), structs };
  });
  const shuffled = random.shuffle(blocks);
  const repeated = random.below(10) === 0 && blocks[0] !== undefined ? [blocks[0]] : [];
  return {
    doc,
    update: encodeHandUpdate([...shuffled, ...repeated]),
    maxSteps: random.below(8) === 0 ? 1 + random.below(20) : 1_000_000,
  };
}
