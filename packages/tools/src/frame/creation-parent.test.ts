// Item 9 review: a gesture's objects join each the section its centre is in, as one
// `createObjects` call per section, in the order drawn.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { frame } from '../select/__fixtures__/select-board.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { withCreationParentGroups } from './creation-parent.js';

/**
 * A sticky to create, its top-left at a board point.
 *
 * @param x - Its x.
 * @param y - Its y.
 * @returns The sticky, without an id.
 */
function note(x: number, y: number) {
  return {
    type: 'sticky',
    parentId: null as ObjectId | null,
    x,
    y,
    width: 20,
    height: 20,
    rotation: 0,
  };
}

it('splits a gesture’s objects by the section each centre is in, keeping their places', () => {
  const { store } = createTextModeContext([
    frame('left', null, { x: 0, y: 0, width: 100, height: 100 }),
    frame('right', null, { x: 200, y: 0, width: 100, height: 100 }),
  ]);
  const groups = withCreationParentGroups(store, [
    note(10, 10),
    note(400, 10),
    note(210, 10),
    note(20, 30),
  ]);
  expect(groups.map(({ parentId, indexes }) => [parentId, indexes])).toEqual([
    ['left', [0, 3]],
    [null, [1]],
    ['right', [2]],
  ]);
  // In each section's coordinates, their own parent left to the call.
  expect(groups[2]?.objects).toEqual([{ ...note(10, 10), parentId: null }]);
  // At the root, as drawn.
  expect(groups[1]?.objects).toEqual([note(400, 10)]);
});

it('ends its walk up a cyclic parent chain', () => {
  const { store } = createTextModeContext([
    frame('a', 'b', { x: 0, y: 0, width: 100, height: 100 }),
    frame('b', 'a', { x: 0, y: 0, width: 100, height: 100 }),
  ]);
  // It returns (which section the note joins is the store's reading of the cycle).
  expect(withCreationParentGroups(store, [note(10, 10)]).map(({ indexes }) => indexes)).toEqual([
    [0],
  ]);
});

it('turns a new object into a turned section’s frame, its rotation kept within (-π, π]', () => {
  const { store } = createTextModeContext([
    frame('turned', null, { x: 0, y: 0, width: 1000, height: 1000, rotation: 1 }),
  ]);
  // A point well inside: the section's local (300, 300) on the board.
  const x = 300 * Math.cos(1) - 300 * Math.sin(1);
  const y = 300 * Math.sin(1) + 300 * Math.cos(1);
  const rotationIn = (rotation: number) => {
    const [group] = withCreationParentGroups(store, [{ ...note(x, y), rotation }]);
    expect(group?.parentId).toBe('turned');
    return group?.objects[0]?.rotation ?? Number.NaN;
  };
  // -3 less 1 wraps up from below -π; a rotation of 1 less 1 needs no wrap.
  expect(rotationIn(-3)).toBeCloseTo(-4 + 2 * Math.PI, 9);
  expect(rotationIn(1)).toBeCloseTo(0, 9);
  const { store: other } = createTextModeContext([
    frame('turned', null, { x: 0, y: 0, width: 1000, height: 1000, rotation: -1 }),
  ]);
  const [group] = withCreationParentGroups(other, [
    {
      ...note(300 * Math.cos(1) + 300 * Math.sin(1), -300 * Math.sin(1) + 300 * Math.cos(1)),
      rotation: 3,
    },
  ]);
  // 3 less -1 wraps down from above π.
  expect(group?.parentId).toBe('turned');
  expect(group?.objects[0]?.rotation).toBeCloseTo(4 - 2 * Math.PI, 9);
});
