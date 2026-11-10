import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import { frame, indexOf, mapSource, rect } from './__fixtures__/select-board.js';
import { createSelectHitTester } from './select-hit-tester.js';

/**
 * A seeded generator in [0, 1).
 *
 * @param seed - The seed.
 * @returns The generator.
 */
function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

/**
 * Rotated rounded frames, whose sharp pick corners reach outside their indexed boxes, among
 * rotated rectangles.
 *
 * @param next - The generator.
 * @returns The objects.
 */
function board(next: () => number): BoardObject[] {
  return Array.from({ length: 60 }, (unused, index) => {
    const box = {
      x: Math.floor(next() * 400),
      y: Math.floor(next() * 400),
      width: 20 + Math.floor(next() * 80),
      height: 20 + Math.floor(next() * 80),
      rotation: next() * Math.PI,
    };
    return index % 2 === 0
      ? { ...frame(`f-${String(index)}`, null, box), cornerRadius: 10 + next() * 30 }
      : rect(`r-${String(index)}`, null, box);
  });
}

describe('MarqueeHits', () => {
  it('equals a fresh hitRect after every move over rotated rounded frames, both modes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = random(seed);
      const objects = board(next);
      const hits = createSelectHitTester(indexOf(objects), mapSource(objects));
      for (const mode of ['intersect', 'contain'] as const) {
        const tracker = hits.marquee?.();
        if (tracker === undefined) throw new Error('Expected a marquee tracker.');
        for (let move = 0; move < 40; move += 1) {
          const x = Math.floor(next() * 300);
          const y = Math.floor(next() * 300);
          const rectangle: WorldBounds = {
            minX: x,
            minY: y,
            maxX: x + 50 + Math.floor(next() * 250),
            maxY: y + 50 + Math.floor(next() * 250),
          };
          expect(
            [...tracker.update(rectangle, mode, null, 0)].sort(),
            `seed ${String(seed)}, ${mode}, move ${String(move)}`,
          ).toEqual([...hits.hitRect(rectangle, mode)].sort());
        }
      }
    }
  });
});
