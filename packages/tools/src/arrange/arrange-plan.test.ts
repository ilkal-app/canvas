import { describe, expect, it } from 'vitest';

import type { ChangeSet, DocumentStore } from '@canvas/document';
import { BOARD_BOUND, type BoardObject } from '@canvas/schema';

import { frame, id, rect, selectBoardObjects } from '../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  ENVIRONMENT,
  storeSource,
} from '../select/__fixtures__/select-store.js';

import {
  ARRANGE_OPERATIONS,
  isArrangeOperation,
  planArrange,
  runArrange,
  type ArrangeOperation,
} from './arrange-plan.js';

/**
 * Runs an operation on the select board (or other objects) and records the change sets.
 *
 * @param operation - The operation.
 * @param ids - The selected ids.
 * @param objects - The board; the select board by default.
 * @returns The store after the operation and the change sets it made.
 */
function arrange(
  operation: ArrangeOperation,
  ids: readonly string[],
  objects?: readonly BoardObject[],
): { store: DocumentStore; changeSets: ChangeSet[] } {
  const store = createSelectStore(objects);
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const plan = planArrange(operation, ids.map(id), storeSource(store));
  if (plan) runArrange(store, ADA, ENVIRONMENT, plan);
  return { store, changeSets };
}

function placement(store: DocumentStore, objectId: string) {
  const object = store.get(id(objectId));
  return object && { x: object.x, y: object.y, parentId: object.parentId };
}

describe('planArrange and runArrange at the board bound', () => {
  it('aligns objects at the two edges of the bound: a move of nearly 2B lands inside it', () => {
    const objects = [
      rect('far-left', null, { x: -BOARD_BOUND, y: 0, width: 10, height: 10 }),
      rect('far-right', null, { x: BOARD_BOUND - 10, y: 0, width: 10, height: 10 }),
    ];
    const store = createSelectStore(objects);
    const plan = planArrange('alignRight', ['far-left', 'far-right'].map(id), storeSource(store));
    if (plan === undefined) throw new Error('expected a plan');
    expect(runArrange(store, ADA, ENVIRONMENT, plan).status).toBe('applied');
    expect(placement(store, 'far-left')).toEqual({ x: BOARD_BOUND - 10, y: 0, parentId: null });
  });

  it('aligns objects a bound apart, the longest move the bound allows', () => {
    const objects = [
      rect('left', null, { x: -BOARD_BOUND / 2, y: 0, width: 10, height: 10 }),
      rect('mid', null, { x: 0, y: 0, width: 10, height: 10 }),
      rect('right', null, { x: BOARD_BOUND / 2 - 10, y: 0, width: 10, height: 10 }),
    ];
    const { store } = arrange('alignLeft', ['left', 'mid', 'right'], objects);
    expect(placement(store, 'right')).toEqual({ x: -BOARD_BOUND / 2, y: 0, parentId: null });
    expect(placement(store, 'mid')).toEqual({ x: -BOARD_BOUND / 2, y: 0, parentId: null });
  });
});

describe('planArrange and runArrange', () => {
  it('aligns an unturned and a turned object by their bounds, in one change set', () => {
    // rect-b, a quarter turn at (200, 0), covers x 150–200: its left edge goes to 0.
    const { store, changeSets } = arrange('alignLeft', ['rect-a', 'rect-b']);
    expect(placement(store, 'rect-b')).toEqual({ x: 50, y: 0, parentId: null });
    expect(placement(store, 'rect-a')).toEqual({ x: 0, y: 0, parentId: null });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.updated).toEqual(['rect-b']);
  });

  it('leaves locked objects where they are and does not align to them', () => {
    const { store, changeSets } = arrange('alignRight', ['rect-a', 'rect-b', 'rect-locked']);
    expect(placement(store, 'rect-a')).toEqual({ x: 100, y: 0, parentId: null });
    expect(placement(store, 'rect-locked')).toEqual({ x: 800, y: 0, parentId: null });
    expect(changeSets.map(({ updated }) => updated)).toEqual([['rect-a']]);
  });

  it('leaves out an object whose parent is selected too, which moves with it', () => {
    // frame-f spans y 0–200, so rect-a's bottom goes to 200; rect-c stays in the frame.
    const { store, changeSets } = arrange('alignBottom', ['frame-f', 'rect-c', 'rect-a']);
    expect(placement(store, 'rect-a')).toEqual({ x: 0, y: 150, parentId: null });
    expect(placement(store, 'rect-c')).toEqual({ x: 20, y: 20, parentId: 'frame-f' });
    expect(changeSets.map(({ updated }) => updated)).toEqual([['rect-a']]);
  });

  it('aligns a group by the bounds of its children, and skips objects without a box', () => {
    const { store } = arrange('alignTop', ['group-g', 'rect-a', 'connector-k']);
    expect(placement(store, 'group-g')).toEqual({ x: 0, y: 0, parentId: null });
    expect(placement(store, 'connector-k')).toEqual({ x: 0, y: 0, parentId: null });
  });

  it('leaves out a group holding a locked object, as it leaves a locked object', () => {
    const objects = selectBoardObjects().map((object) =>
      object.id === 'rect-e' ? { ...object, locked: true } : object,
    );
    const { store, changeSets } = arrange('alignTop', ['group-g', 'rect-a', 'rect-b'], objects);
    expect(placement(store, 'group-g')).toEqual({ x: 0, y: 300, parentId: null });
    expect(changeSets.flatMap(({ updated }) => updated)).not.toContain('group-g');
  });

  it('aligns a single object to the frame it is in', () => {
    const right = arrange('alignRight', ['rect-c']).store;
    expect(placement(right, 'rect-c')).toEqual({ x: 250, y: 20, parentId: 'frame-f' });
    const middle = arrange('alignMiddle', ['rect-c']).store;
    expect(placement(middle, 'rect-c')).toEqual({ x: 20, y: 75, parentId: 'frame-f' });
  });

  it('does nothing to a single object at the root or in a group', () => {
    const source = storeSource(createSelectStore());
    expect(planArrange('alignLeft', [id('rect-a')], source)).toBeUndefined();
    expect(planArrange('alignRight', [id('rect-d')], source)).toBeUndefined();
    expect(planArrange('alignRight', [id('rect-a'), id('rect-locked')], source)).toBeUndefined();
    expect(planArrange('alignLeft', [], source)).toBeUndefined();
  });

  it('aligns objects with different parents on the board, each staying in its parent', () => {
    // rect-c is at (420, 20) on the board; the board's left edge of the two is rect-a's, 0.
    const { store } = arrange('alignLeft', ['rect-a', 'rect-c']);
    expect(placement(store, 'rect-c')).toEqual({ x: -400, y: 20, parentId: 'frame-f' });
    const top = arrange('alignTop', ['rect-a', 'rect-c']).store;
    expect(placement(top, 'rect-c')).toEqual({ x: 20, y: 0, parentId: 'frame-f' });
  });

  it('aligns objects in a turned frame along the frame’s own axes', () => {
    const objects = [
      frame('frame-r', null, { x: 500, y: 500, width: 400, height: 400, rotation: Math.PI / 2 }),
      rect('p', 'frame-r', { x: 10, y: 10, width: 50, height: 50 }),
      rect('q', 'frame-r', { x: 100, y: 200, width: 60, height: 40 }),
    ];
    const left = arrange('alignLeft', ['p', 'q'], objects).store;
    expect(left.get(id('q'))?.x).toBeCloseTo(10, 9);
    expect(left.get(id('q'))?.y).toBeCloseTo(200, 9);
    const bottom = arrange('alignBottom', ['p', 'q'], objects).store;
    expect(bottom.get(id('p'))?.x).toBeCloseTo(10, 9);
    expect(bottom.get(id('p'))?.y).toBeCloseTo(190, 9);
    // Alone, q aligns to the turned frame: its right edge on the frame's, 400.
    const alone = arrange('alignRight', ['q'], objects).store;
    expect(alone.get(id('q'))?.x).toBeCloseTo(340, 9);
  });

  it('distributes and tidies in one change set each', () => {
    const row = [
      rect('r1', null, { x: 0, y: 0, width: 50, height: 50 }),
      rect('r2', null, { x: 70, y: 0, width: 50, height: 50 }),
      rect('r3', null, { x: 300, y: 0, width: 50, height: 50 }),
    ];
    const spread = arrange('distributeHorizontally', ['r1', 'r2', 'r3'], row);
    expect(placement(spread.store, 'r2')).toEqual({ x: 150, y: 0, parentId: null });
    expect(spread.changeSets).toHaveLength(1);
    const column = row.map((each) => ({ ...each, x: each.y, y: each.x }));
    const stacked = arrange('distributeVertically', ['r1', 'r2', 'r3'], column);
    expect(placement(stacked.store, 'r2')).toEqual({ x: 0, y: 150, parentId: null });
    // Rows r1 r2 / r3 r4; gaps 50, 45 and 41 between the rows: spaced by 45.
    const scattered = [
      rect('r1', null, { x: 0, y: 0, width: 50, height: 50 }),
      rect('r2', null, { x: 100, y: 5, width: 50, height: 50 }),
      rect('r3', null, { x: 3, y: 100, width: 50, height: 50 }),
      rect('r4', null, { x: 98, y: 96, width: 50, height: 50 }),
    ];
    const tidy = arrange('tidyUp', ['r1', 'r2', 'r3', 'r4'], scattered);
    expect(['r1', 'r2', 'r3', 'r4'].map((each) => placement(tidy.store, each))).toEqual([
      { x: 0, y: 0, parentId: null },
      { x: 95, y: 0, parentId: null },
      { x: 0, y: 95, parentId: null },
      { x: 95, y: 95, parentId: null },
    ]);
    expect(tidy.changeSets).toHaveLength(1);
  });

  it('writes nothing when everything is already in place', () => {
    const { changeSets } = arrange('alignTop', ['rect-a', 'frame-f']);
    expect(changeSets).toEqual([]);
  });

  it('names the nine operations', () => {
    expect(ARRANGE_OPERATIONS).toHaveLength(9);
    expect(ARRANGE_OPERATIONS.every(isArrangeOperation)).toBe(true);
    expect(isArrangeOperation('group')).toBe(false);
  });
});
