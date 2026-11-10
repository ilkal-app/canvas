import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import { CandidateFinder } from './image-candidates.js';
import { ImageIndex } from './image-index.js';

it('retains the priority revision until a fixed candidate crosses the inclusive viewport edge', () => {
  const index = new ImageIndex();
  for (const [id, x] of [
    ['inside', 500],
    ['near', 1050],
  ] as const) {
    index.track({
      object: imageObject({ id: id as ObjectId, width: 100, height: 100 }),
      transform: { cos: 1, sin: 0, x, y: 0 },
    });
  }
  const view = (x: number) => ({ minX: x, minY: 0, maxX: x + 1000, maxY: 1000 });
  const finder = new CandidateFinder();
  finder.find(index, view(0), 0);
  const revision = finder.priorityRevision;
  expect(revision).toBe(1);
  expect(finder.pan(index, view(10), 100)).toBe(true);
  expect(finder.priorityRevision).toBe(revision);
  expect(finder.pan(index, view(50), 200)).toBe(true);
  expect(finder.priorityRevision).toBe(revision + 1);
  expect(finder.current.map(({ priority }) => priority)).toEqual(['visible', 'visible']);
  expect(finder.pan(index, view(49), 300)).toBe(true);
  expect(finder.priorityRevision).toBe(revision + 2);
  expect(finder.current.map(({ priority }) => priority)).toEqual(['visible', 'near']);
});
