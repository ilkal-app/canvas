import { describe, expect, it } from 'vitest';

import type { AutoLayout, BoardObject } from '@canvas/schema';

import { frame, group, id, mapSource, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { runStackDrop, stackSlotOf, thickenedLine } from './stack-reorder.js';

// The slot a dragged box takes in a live auto-layout's stack. The row frame is at (100,
// 100), 300 × 100, padding 10 and gap 10, holding a, b and c, 40 × 40 each, stacked in that order
// at x 10, 60 and 110 in the frame (centres 30, 80 and 130).

/** A row, padding 10 and gap 10. */
const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};

/**
 * The row frame and its three children, with a layout or none.
 *
 * @param autoLayout - The frame's auto-layout, if any.
 * @param rotation - The frame's rotation, radians.
 * @param extra - More objects.
 * @returns The document.
 */
function stack(autoLayout: AutoLayout | undefined, rotation = 0, extra: BoardObject[] = []) {
  const container = {
    ...frame('row', null, { x: 100, y: 100, width: 300, height: 100, rotation }),
    ...(autoLayout === undefined ? {} : { autoLayout }),
  };
  const child = (name: string, x: number, z: string) => ({
    ...rect(name, 'row', { x, y: 10, width: 40, height: 40 }),
    z,
  });
  return mapSource([
    container,
    child('a', 10, 'a0'),
    child('b', 60, 'a1'),
    child('c', 110, 'a2'),
    ...extra,
  ]);
}

describe('stackSlotOf', () => {
  it('goes before the first child whose centre lies past the dragged centre', () => {
    const document = stack(ROW);
    const slot = stackSlotOf(id('row'), new Set([id('b')]), { x: 160, y: 130 }, document);
    // 60 in the frame: past a (30), before c (130); the line halfway between a's end and c's start.
    expect(slot).toEqual({
      containerId: 'row',
      belowId: 'c',
      line: { x: 180, y: 110, width: 0, height: 80, rotation: 0 },
    });
  });

  it('goes first, against the padding, before every centre', () => {
    const slot = stackSlotOf(id('row'), new Set([id('c')]), { x: 115, y: 130 }, stack(ROW));
    expect(slot?.belowId).toBe('a');
    expect(slot?.line).toMatchObject({ x: 110, y: 110 });
  });

  it('goes to the end of the stack past every centre', () => {
    const slot = stackSlotOf(id('row'), new Set([id('a')]), { x: 390, y: 130 }, stack(ROW));
    expect(slot?.belowId).toBeUndefined();
    // After c's end, 150 in the frame.
    expect(slot?.line).toMatchObject({ x: 250, y: 110 });
  });

  it('reads a column along y, with a line across it', () => {
    const column: AutoLayout = { ...ROW, direction: 'column' };
    const document = mapSource([
      { ...frame('row', null, { x: 100, y: 100, width: 100, height: 300 }), autoLayout: column },
      { ...rect('a', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
      { ...rect('b', 'row', { x: 10, y: 60, width: 40, height: 40 }), z: 'a1' },
    ]);
    const slot = stackSlotOf(id('row'), new Set(), { x: 130, y: 150 }, document);
    // 50 down the frame: past a (30), before b (80).
    expect(slot).toEqual({
      containerId: 'row',
      belowId: 'b',
      line: { x: 110, y: 155, width: 80, height: 0, rotation: 0 },
    });
  });

  it('reads the stack in the container’s own frame when it is turned', () => {
    // A quarter turn: the row runs down the board from (100, 100).
    const document = stack(ROW, Math.PI / 2);
    const slot = stackSlotOf(id('row'), new Set([id('b')]), { x: 70, y: 160 }, document);
    expect(slot?.belowId).toBe('c');
    // Halfway between a and c, 80 along the row and 10 in from its edge: (90, 180) on the board.
    expect(slot?.line.x).toBeCloseTo(90);
    expect(slot?.line.y).toBeCloseTo(180);
    expect(slot?.line).toMatchObject({ width: 0, height: 80, rotation: Math.PI / 2 });
  });

  it('skips a child the engine does not draw, which has no box', () => {
    const document = stack(ROW);
    const undrawn = { ...document, isDrawable: (objectId: string) => objectId !== 'a' };
    // Without a, b is first: a centre at 20 in the frame goes before it.
    const slot = stackSlotOf(id('row'), new Set([id('c')]), { x: 120, y: 130 }, undrawn);
    expect(slot?.belowId).toBe('b');
  });

  it('breaks a tie of stacking keys by id', () => {
    const document = mapSource([
      { ...frame('row', null, { x: 100, y: 100, width: 300, height: 100 }), autoLayout: ROW },
      { ...rect('y', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
      { ...rect('x', 'row', { x: 60, y: 10, width: 40, height: 40 }), z: 'a0' },
    ]);
    // Same key, so x stacks before y; 20 in the frame is before x's centre (80), the first.
    expect(stackSlotOf(id('row'), new Set(), { x: 120, y: 130 }, document)?.belowId).toBe('x');
  });

  it.each([
    ['row', { x: 110, y: 110, width: 0, height: 80 }],
    ['column', { x: 110, y: 110, width: 280, height: 0 }],
  ] as const)('puts the line against the padding in an empty %s', (direction, line) => {
    const document = mapSource([
      {
        ...frame('row', null, { x: 100, y: 100, width: 300, height: 100 }),
        autoLayout: { ...ROW, direction },
      },
    ]);
    const slot = stackSlotOf(id('row'), new Set(), { x: 200, y: 150 }, document);
    expect(slot).toEqual({
      containerId: 'row',
      belowId: undefined,
      line: { ...line, rotation: 0 },
    });
  });

  it('is nothing for a container the board does not have', () => {
    expect(stackSlotOf(id('gone'), new Set(), { x: 0, y: 0 }, stack(ROW))).toBeUndefined();
  });

  it('skips children that do not stack, and is nothing without a layout', () => {
    const lineless = stack(ROW, 0, [{ ...group('g', 'row', 0, 0, 0), z: 'a3' }]);
    expect(stackSlotOf(id('row'), new Set(), { x: 390, y: 130 }, lineless)?.belowId).toBe(
      undefined,
    );
    expect(stackSlotOf(id('row'), new Set(), { x: 130, y: 130 }, stack(undefined))).toBe(undefined);
  });
});

describe('thickenedLine', () => {
  it('widens a line of no width about its axis, and one of no height likewise', () => {
    expect(thickenedLine({ x: 10, y: 0, width: 0, height: 50, rotation: 0 }, 2)).toEqual({
      x: 9,
      y: 0,
      width: 2,
      height: 50,
      rotation: 0,
    });
    expect(thickenedLine({ x: 0, y: 10, width: 50, height: 0, rotation: 0 }, 4)).toEqual({
      x: 0,
      y: 8,
      width: 50,
      height: 4,
      rotation: 0,
    });
  });
});

describe('runStackDrop', () => {
  it('places the boxes below the slot’s child in one change set, keeping their order', () => {
    const objects = [
      { ...frame('row', null, { x: 100, y: 100, width: 300, height: 100 }), autoLayout: ROW },
      { ...rect('a', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
      { ...rect('b', 'row', { x: 60, y: 10, width: 40, height: 40 }), z: 'a1' },
      { ...rect('c', 'row', { x: 110, y: 10, width: 40, height: 40 }), z: 'a2' },
    ];
    const store = createSelectStore(objects);
    let changeSets = 0;
    store.subscribe(() => (changeSets += 1));
    const slot = { containerId: id('row'), belowId: id('a'), line: objects[0] as never };
    const ids = [id('c'), id('b')];
    expect(runStackDrop(store, ADA, ENVIRONMENT, storeSource(store), ids, slot)).toEqual([]);
    expect(changeSets).toBe(1);
    expect(['b', 'c', 'a'].map((name) => store.get(id(name))?.x)).toEqual([10, 60, 110]);
  });

  it('returns the refusal and writes nothing when the container is gone', () => {
    const store = createSelectStore([
      { ...rect('a', null, { x: 0, y: 0, width: 40, height: 40 }), z: 'a0' },
    ]);
    const before = store.encodeState();
    const slot = { containerId: id('row'), belowId: undefined, line: {} as never };
    const ids = [id('a'), id('ghost')];
    const errors = runStackDrop(store, ADA, ENVIRONMENT, storeSource(store), ids, slot);
    expect(errors.length).toBeGreaterThan(0);
    expect(store.encodeState()).toEqual(before);
  });
});
