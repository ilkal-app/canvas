// The sticky note under a press for the sticky tool's Shift+click, over a fake hit
// tester. In Chrome: tooling/scenario/specs/app/sticky-stack.acceptance.spec.ts.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';
import type { PointHit, SelectHitTester } from '@canvas/tools';

import { stickyUnder } from './sticky-under.js';

describe('stickyUnder', () => {
  // A press over note `n` in group `inner` in group `outer`: the hit is the outermost group not
  // entered, as the select tool's is.
  const types: Readonly<Record<string, BoardObject['type']>> = {
    outer: 'group',
    inner: 'group',
    n: 'sticky',
    s: 'shape',
  };
  const store = {
    get: (id: ObjectId) =>
      types[id] === undefined ? undefined : ({ id, type: types[id] } as BoardObject),
  };
  const hitsIn =
    (byScope: Readonly<Record<string, PointHit | undefined>>) =>
    (...[, , entered]: Parameters<SelectHitTester['hitPoint']>) =>
      byScope[entered ?? 'top'];
  const hit = (id: string, part: PointHit['part'] = 'object'): PointHit => ({
    id: id as ObjectId,
    scope: null,
    part,
  });
  const at = { x: 0, y: 0 };

  it('finds a note inside nested groups by entering each', () => {
    const hitPoint = hitsIn({ top: hit('outer'), outer: hit('inner'), inner: hit('n') });
    expect(stickyUnder({ hitPoint }, store, at, 1)).toBe('n');
  });

  it('finds an ungrouped note, and nothing for another object, a frame part or empty board', () => {
    expect(stickyUnder({ hitPoint: hitsIn({ top: hit('n') }) }, store, at, 1)).toBe('n');
    expect(stickyUnder({ hitPoint: hitsIn({ top: hit('s') }) }, store, at, 1)).toBeUndefined();
    expect(
      stickyUnder({ hitPoint: hitsIn({ top: hit('n', 'title') }) }, store, at, 1),
    ).toBeUndefined();
    expect(stickyUnder({ hitPoint: hitsIn({}) }, store, at, 1)).toBeUndefined();
  });

  it('stops at a group whose entered hit is the group again', () => {
    const hitPoint = hitsIn({ top: hit('outer'), outer: hit('outer') });
    expect(stickyUnder({ hitPoint }, store, at, 1)).toBeUndefined();
  });
});
