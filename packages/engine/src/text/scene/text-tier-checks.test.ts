import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { TextTierChecks, type VisibleObjects } from './text-tier-checks.js';

const ids = (...names: string[]): ObjectId[] => names as ObjectId[];

function visibleSet(
  names: readonly string[],
  revision: number,
  entered: readonly string[] = names,
): VisibleObjects {
  const visible = new Set(names);
  return {
    visibleRevision: revision,
    visibleIds: ids(...names),
    enteredIds: ids(...entered),
    isVisible: (id) => visible.has(id),
  };
}

describe('TextTierChecks', () => {
  it('queues nothing on a zoom that takes no font size across a tier edge', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    // 16 px text: 16 to 32 device px per em, far from the 128 px boundary.
    checks.rescale(1, 2, ids('a', 'b'));
    expect(checks.due(visibleSet(['a', 'b'], 1))).toEqual([]);
  });

  it('queues every text on a zoom across an edge and hands out the visible ones', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    // 16 px text at 7 and at 9 device px per unit: 112 and 144 px per em, across 128.
    checks.rescale(7, 9, ids('a', 'b'));
    expect(checks.due(visibleSet(['a'], 1))).toEqual(ids('a'));
    // Nothing new was queued and the visible set is the same: no walk.
    expect(checks.due(visibleSet(['a', 'b'], 1))).toEqual([]);
    // The visible set changed: the off-screen text is checked once it is in view.
    expect(checks.due(visibleSet(['a', 'b'], 2, ['b']))).toEqual(ids('b'));
    expect(checks.due(visibleSet(['a', 'b'], 3, []))).toEqual([]);
  });

  it('forgets a deleted text', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    checks.rescale(7, 9, ids('a'));
    checks.forget('a' as ObjectId);
    expect(checks.due(visibleSet(['a'], 1))).toEqual([]);
  });

  it('looks up only the texts entering the view, whatever is queued off screen', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    const all = Array.from({ length: 20_000 }, (unused, index) => `t${String(index)}`);
    checks.rescale(7, 9, ids(...all));
    const onScreen = all.slice(0, 2_000);
    expect(checks.due(visibleSet(onScreen, 1))).toHaveLength(2_000);
    // 18,000 texts stay queued off screen; the view moves by ten.
    const entering = all.slice(2_000, 2_010);
    const moved = [...onScreen.slice(10), ...entering];
    let lookups = 0;
    /**
     * An array that counts the elements read from it.
     *
     * @param names - Its ids.
     * @returns The array.
     */
    const counting = (names: readonly string[]): ObjectId[] =>
      new Proxy(ids(...names), {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) lookups += 1;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    const counted: VisibleObjects = {
      visibleRevision: 2,
      visibleIds: counting(moved),
      enteredIds: counting(entering),
      isVisible: () => {
        lookups += 1;
        return true;
      },
    };
    expect(checks.due(counted)).toEqual(ids(...entering));
    // Ten lookups: the entering ids, not the 2,000 visible or the 18,000 queued.
    expect(lookups).toBe(entering.length);
    // A missed revision walks the smaller of the queue and the visible set.
    const late = checks.due({ ...visibleSet(all.slice(5_000, 5_010), 9), isVisible: () => true });
    expect(late).toEqual(ids(...all.slice(5_000, 5_010)));
  });

  it('hands out every queued text when every object is visible', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    checks.rescale(7, 9, ids('a', 'b'));
    const everything: VisibleObjects = {
      visibleRevision: 1,
      visibleIds: undefined,
      enteredIds: [],
      isVisible: () => true,
    };
    expect([...checks.due(everything)].sort()).toEqual(ids('a', 'b'));
    expect(checks.due({ ...everything, visibleRevision: 2 })).toEqual([]);
  });
  it('does not materialize the full ID array when an incremental visibility count is available', () => {
    const checks = new TextTierChecks();
    checks.noteFontSizes([16]);
    checks.rescale(7, 9, ids('a', 'b'));
    expect(checks.due(visibleSet(['a'], 1))).toEqual(ids('a'));
    const next: VisibleObjects = {
      visibleRevision: 2,
      visibleCount: 50_000,
      get visibleIds(): readonly ObjectId[] {
        throw new Error('The entering-only path must not materialize visible IDs.');
      },
      enteredIds: ids('b'),
      isVisible: () => true,
    };
    expect(checks.due(next)).toEqual(ids('b'));
  });
});
