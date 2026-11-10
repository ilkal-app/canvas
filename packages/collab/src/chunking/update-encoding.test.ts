import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { splitDeleteSet } from './update-encoding.js';

it('splits a delete set into delete-only updates within the limit, one range at least each', () => {
  const deleteSet = Y.createDeleteSet();
  const ranges = (client: number, count: number) =>
    Array.from({ length: count }, (unused, index) => ({ clock: index * 1_000 + client, len: 3 }));
  deleteSet.clients.set(7, ranges(7, 60));
  deleteSet.clients.set(9, ranges(9, 5));
  const chunks = splitDeleteSet(deleteSet, 40);
  expect(chunks.length).toBeGreaterThan(5);
  for (const chunk of chunks) {
    expect(chunk.byteLength).toBeLessThanOrEqual(40);
    expect(Y.decodeUpdate(chunk).structs).toEqual([]);
  }
  const merged = Y.mergeDeleteSets(chunks.map((chunk) => Y.decodeUpdate(chunk).ds));
  expect(Y.equalDeleteSets(merged, Y.mergeDeleteSets([deleteSet]))).toBe(true);
  expect(splitDeleteSet(Y.createDeleteSet(), 40)).toEqual([]);
});
