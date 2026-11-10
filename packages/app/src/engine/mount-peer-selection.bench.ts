// Collaborators' selections (item 14) at the budget's twenty collaborators (CLAUDE.md,
// "Budgets"): placing every peer's selection again, as a presence flush, a board change or a
// drag frame does. Each peer is one box; up to MAX_OUTLINED_PER_PEER objects it is framed from
// each object's box, past that from the spatial index, so the work stays bounded however much
// is selected.
import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { MAX_OUTLINED_PER_PEER, MountPeerSelection } from './mount-peer-selection.js';

const PEERS = 20;
const OBJECTS = 2000;

const objects = new Map<string, BoardObject>();
for (let index = 0; index < OBJECTS; index += 1) {
  const id = `o${String(index)}`;
  objects.set(id, {
    id,
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    x: (index % 50) * 60,
    y: Math.floor(index / 50) * 40,
    rotation: 0,
    width: 40,
    height: 20,
  } as unknown as BoardObject);
}
const store = {
  get: (id: ObjectId) => objects.get(id),
  references: { childrenOf: () => [] },
};
// The board's spatial index, as the app has it: an object's bounds, one lookup each.
const snapIndex = {
  boundsOf: (id: ObjectId) => {
    const object = objects.get(id) as unknown as { x: number; y: number } | undefined;
    return object && { minX: object.x, minY: object.y, maxX: object.x + 40, maxY: object.y + 20 };
  },
};
const source = { get: store.get, childrenOf: store.references.childrenOf };
const document = { tools: { services: () => ({ selectTool: { source }, snapIndex, store }) } };
const ids = [...objects.keys()];

/**
 * Twenty peers, each selecting `count` objects of their own stretch of the board.
 *
 * @param count - How many each selects.
 * @returns The peers.
 */
function peersSelecting(count: number) {
  return [...Array(PEERS).keys()].map((index) => ({
    clientId: index + 1,
    principalId: `peer-${String(index)}`,
    name: `Peer ${String(index)}`,
    color: '#3366cc',
    ids: ids.slice(index * 50, index * 50 + count),
  }));
}

describe(`peer selections: ${String(PEERS)} collaborators`, () => {
  const mount = new MountPeerSelection(() => document as never, { show: () => undefined });
  const few = peersSelecting(10);
  const atCap = peersSelecting(MAX_OUTLINED_PER_PEER);
  const all = peersSelecting(1000);
  bench('10 objects each', () => {
    mount.show(few);
  });
  bench(`${String(MAX_OUTLINED_PER_PEER)} objects each, framed from their boxes`, () => {
    mount.show(atCap);
  });
  bench('1,000 objects each, framed from the index', () => {
    mount.show(all);
  });
});
