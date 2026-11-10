import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { ScenePass } from '../scene-pass.js';

import {
  occludersByRank,
  rankHoldsPass,
  ranksByObject,
  ranksOfPass,
  slotsOfRank,
} from './closing-ranks.js';

const id = (value: string) => value as ObjectId;

/** A frame at rank 0 with a child at 1, closed at 2; a shape at 3. */
const ORDER = [id('frame'), id('child'), id('frame'), id('shape')];
const CLOSING = Uint8Array.of(0, 0, 1, 0);

/**
 * A pass that flags the given objects.
 *
 * @param name - Its name.
 * @param flags - The ids it flags.
 * @param isAfter - Whether it is drawn after descendants.
 * @returns The pass, enough for these functions.
 */
function pass(name: string, flags: readonly string[], isAfter = false): ScenePass {
  return {
    name,
    isOccluder: (object: BoardObject) => flags.includes(object.id),
    ...(isAfter ? { isDrawnAfterDescendants: true } : {}),
  } as unknown as ScenePass;
}

describe('closing ranks', () => {
  it('indexes own ranks and closing ranks apart', () => {
    const { rankById, closingRankById } = ranksByObject(ORDER, CLOSING);
    expect([...rankById]).toEqual([
      ['frame', 0],
      ['child', 1],
      ['shape', 3],
    ]);
    expect([...closingRankById]).toEqual([['frame', 2]]);
  });

  it('flags an own rank by the other passes and a closing rank by the after passes', () => {
    const objects = new Map(ORDER.map((value) => [value, { id: value } as BoardObject]));
    const mirror = {
      get: (value: ObjectId) => (value === 'child' ? undefined : objects.get(value)),
      isOccluder: (object: BoardObject, passes: readonly ScenePass[]) =>
        passes.some((each) => each.isOccluder?.(object) === true),
    };
    const background = pass('background', ['shape']);
    const outline = pass('outline', ['frame'], true);
    expect([...occludersByRank(ORDER, CLOSING, mirror, [background, outline])]).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it('gives a closing rank only the after passes’ records, an own rank the rest', () => {
    const { closingRankById } = ranksByObject(ORDER, CLOSING);
    const holds = rankHoldsPass(
      [pass('background', []), pass('outline', [], true)],
      CLOSING,
      closingRankById,
    );
    expect(holds(0, id('frame'), 'background')).toBe(true);
    expect(holds(0, id('frame'), 'outline')).toBe(false);
    expect(holds(2, id('frame'), 'outline')).toBe(true);
    expect(holds(2, id('frame'), 'background')).toBe(false);
    // An object without a closing rank holds every pass at its own rank.
    expect(holds(3, id('shape'), 'outline')).toBe(true);
  });

  it('ranks an after pass’s records at closing ranks, any other pass’s at own ranks', () => {
    const { rankById, closingRankById } = ranksByObject(ORDER, CLOSING);
    expect(ranksOfPass({ isDrawnAfterDescendants: true }, rankById, closingRankById)).toBe(
      closingRankById,
    );
    expect(ranksOfPass({}, rankById, closingRankById)).toBe(rankById);
  });

  it('looks a rank’s slots up only where the rank holds the pass, and none past the order', () => {
    const { closingRankById } = ranksByObject(ORDER, CLOSING);
    const scene = {
      passes: [pass('outline', [], true)],
      slotsOf: (value: ObjectId, name: string) => [`${value}:${name}`.length],
    };
    const lookup = slotsOfRank(scene, ORDER, CLOSING, closingRankById);
    expect(lookup(2, 'outline')).toEqual(['frame:outline'.length]);
    expect(lookup(0, 'outline')).toEqual([]);
    expect(lookup(9, 'outline')).toEqual([]);
  });
});
