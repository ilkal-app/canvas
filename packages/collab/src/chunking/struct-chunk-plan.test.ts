import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { planStructChunks } from './struct-chunk-plan.js';
import { encodedStructBytes } from './update-encoding.js';

it('ends with every struct placed when dependencies form a cycle no update can carry', () => {
  // Integrated content never has a cycle; hostile or corrupt bytes might.
  // Its neighbour is of a client the update does not carry: available at once.
  const free = new Y.Item(
    Y.createID(3, 0),
    null,
    Y.createID(4, 0),
    null,
    null,
    null,
    null,
    new Y.ContentAny([0]),
  );
  const first = new Y.Item(
    Y.createID(1, 0),
    null,
    Y.createID(2, 0),
    null,
    null,
    null,
    null,
    new Y.ContentAny([1]),
  );
  const second = new Y.Item(
    Y.createID(2, 0),
    null,
    Y.createID(1, 0),
    null,
    null,
    null,
    null,
    new Y.ContentAny([2]),
  );
  const chunks = planStructChunks([free, first, second], 1024, encodedStructBytes);
  const placed = chunks.flatMap((chunk) => [...chunk.values()].flat());
  expect(placed).toEqual([free, first, second]);
});
