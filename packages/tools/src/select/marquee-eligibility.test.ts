import { describe, expect, it } from 'vitest';

import { id, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import { isMarqueeEligible } from './marquee-eligibility.js';

const SOURCE = mapSource(selectBoardObjects());

/** Round frame-f (x 400–700, y 0–200) with room to spare. */
const AROUND_FRAME = { minX: 390, minY: -10, maxX: 710, maxY: 210 };

/** Over frame-f's left part only, enclosing rect-c (x 420–470, y 20–70). */
const INSIDE_FRAME = { minX: 390, minY: -10, maxX: 480, maxY: 80 };

/** Round the whole of group-g (x 0–100, y 300–340). */
const AROUND_GROUP = { minX: -5, minY: 295, maxX: 105, maxY: 345 };

/** Over group-g's left child only. */
const PART_OF_GROUP = { minX: -5, minY: 295, maxX: 50, maxY: 345 };

describe('isMarqueeEligible', () => {
  it('takes a frame only when the marquee encloses it, in either direction', () => {
    for (const mode of ['intersect', 'contain'] as const) {
      expect(isMarqueeEligible(id('frame-f'), AROUND_FRAME, mode, SOURCE)).toBe(true);
      expect(isMarqueeEligible(id('frame-f'), INSIDE_FRAME, mode, SOURCE)).toBe(false);
    }
  });

  it('takes a group on touch dragging right, and only enclosed dragging left', () => {
    expect(isMarqueeEligible(id('group-g'), PART_OF_GROUP, 'intersect', SOURCE)).toBe(true);
    expect(isMarqueeEligible(id('group-g'), PART_OF_GROUP, 'contain', SOURCE)).toBe(false);
    expect(isMarqueeEligible(id('group-g'), AROUND_GROUP, 'contain', SOURCE)).toBe(true);
  });

  it('leaves every other object to the engine’s contain-or-intersect test', () => {
    for (const mode of ['intersect', 'contain'] as const) {
      expect(isMarqueeEligible(id('rect-c'), INSIDE_FRAME, mode, SOURCE)).toBe(true);
      expect(isMarqueeEligible(id('line-l'), INSIDE_FRAME, mode, SOURCE)).toBe(true);
    }
  });

  it('takes nothing that is not in the document', () => {
    expect(isMarqueeEligible(id('missing'), AROUND_FRAME, 'intersect', SOURCE)).toBe(false);
  });
});
