import { describe, expect, it } from 'vitest';

import { isFarObject } from '@canvas/document';
import { BOARD_BOUND } from '@canvas/schema';

import { group, id, mapSource, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { farIds, farSkipOf, nearIds } from './far-objects.js';
import { boxAround } from './oriented-box.js';
import { selectionFrameOf } from './selection-frame.js';
import { orientedBoxOf } from './selection-geometry.js';
import { planTransform, runTransformPlan } from './transform-plan.js';

// The select tool and far objects: an object whose box on the board, or a descendant's,
// is past the bound or cannot be worked out. A transform skips them (and says so), and takes its
// pivot and origin from the rest; delete and a move to a position inside still work. Storing a
// number past the bound does not make an object far.

const B = BOARD_BOUND;

/**
 * Whether an object of a source is far, by id.
 *
 * @param source - The source.
 * @param name - The object's id.
 * @returns `isFarObject` of it; `false` when it is missing.
 */
function isFar(source: ReturnType<typeof mapSource>, name: string): boolean {
  return isFarObject(source, id(name));
}

/**
 * The fixture board: rect-near (0, 0) and rect-near-2 (200, 0), both 100 × 50; rect-far at
 * x = 1e300.
 *
 * @returns The objects.
 */
function board() {
  return [
    rect('rect-near', null, { x: 0, y: 0, width: 100, height: 50 }),
    rect('rect-near-2', null, { x: 200, y: 0, width: 100, height: 50 }),
    rect('rect-far', null, { x: 1e300, y: 0, width: 100, height: 50 }),
  ];
}

describe('isFarObject', () => {
  it('is false for an object within the bound, on the edge of it too', () => {
    const source = mapSource([
      rect('a', null, { x: 0, y: 0, width: 10, height: 10 }),
      rect('edge', null, { x: B, y: -B, width: 0, height: 0 }),
    ]);
    expect(isFar(source, 'a')).toBe(false);
    expect(isFar(source, 'edge')).toBe(false);
  });

  it('is true for an object past the bound, a size past it, and a non-finite position', () => {
    const source = mapSource([
      rect('x', null, { x: B + 1, y: 0, width: 1, height: 1 }),
      rect('wide', null, { x: 0, y: 0, width: 1e300, height: 1 }),
      rect('nan', null, { x: Number.NaN, y: 0, width: 1, height: 1 }),
    ]);
    for (const name of ['x', 'wide', 'nan']) {
      expect(isFar(source, name)).toBe(true);
    }
  });

  it('is true for a child of a far group and for a group holding a far child', () => {
    const source = mapSource([
      group('far-group', null, 1e300, 0),
      rect('under-far', 'far-group', { x: 0, y: 0, width: 5, height: 5 }),
      group('near-group', null, 0, 0),
      rect('far-child', 'near-group', { x: 1e300, y: 0, width: 5, height: 5 }),
    ]);
    for (const name of ['under-far', 'near-group']) {
      expect(isFar(source, name)).toBe(true);
    }
  });
});

describe('isFarObject, by where the object lands', () => {
  it('is false for a member that stores 2B from its group but lies inside the bound', () => {
    const source = mapSource([
      group('pair', null, -B, 0),
      rect('left', 'pair', { x: 0, y: 0, width: 0, height: 10 }),
      rect('right', 'pair', { x: 2 * B, y: 0, width: 0, height: 10 }),
    ]);
    for (const name of ['pair', 'left', 'right']) expect(isFar(source, name)).toBe(false);
  });

  it('is true for a box whose far edge, or a turned corner, is past the bound', () => {
    const source = mapSource([
      rect('edge', null, { x: B - 10, y: 0, width: 100, height: 10 }),
      rect('turned', null, { x: B - 100, y: 0, width: 100, height: 100, rotation: -Math.PI / 4 }),
    ]);
    expect(isFar(source, 'edge')).toBe(true);
    expect(isFar(source, 'turned')).toBe(true);
  });

  it('is true for a child whose own and ancestors coordinates are each within the bound but sum past it', () => {
    const source = mapSource([
      group('outer', null, 0.75 * B, 0),
      rect('inner', 'outer', { x: 0.75 * B, y: 0, width: 5, height: 5 }),
      rect('inside', 'outer', { x: 0.25 * B - 5, y: 0, width: 5, height: 5 }),
    ]);
    expect(isFar(source, 'inner')).toBe(true);
    expect(isFar(source, 'inside')).toBe(false);
  });
});

describe('the selection of near and far objects', () => {
  const source = mapSource(board());
  const ids = ['rect-near', 'rect-near-2', 'rect-far'].map(id);

  it('the frame the handles sit on is round the near objects only', () => {
    const frame = selectionFrameOf(ids, source);
    const near = ['rect-near', 'rect-near-2'].map(id);
    const expected = boxAround(
      near.flatMap((one) => {
        const box = orientedBoxOf(one, source);
        return box
          ? [
              { x: box.x, y: box.y },
              { x: box.x + box.width, y: box.y + box.height },
            ]
          : [];
      }),
    );
    expect(frame).toEqual(expected);
    expect(frame).toMatchObject({ x: 0, y: 0, width: 300, height: 50 });
  });

  it('a lone far object has no frame, so no handle, no pivot and no origin', () => {
    expect(selectionFrameOf([id('rect-far')], source)).toBeUndefined();
  });

  it('nearIds leaves the far ones out and farIds names them, farSkipOf counts them', () => {
    expect(nearIds(ids, source)).toEqual(['rect-near', 'rect-near-2']);
    expect(farIds(ids, source)).toEqual(['rect-far']);
    expect(farSkipOf(ids, source)).toEqual({ ids: ['rect-far'], isEvery: false });
    expect(farSkipOf([id('rect-far')], source)).toEqual({ ids: ['rect-far'], isEvery: true });
    expect(farSkipOf([id('rect-near')], source)).toBeUndefined();
  });
});

describe('a transform planned from the tool’s own geometry under a far object', () => {
  it('rotates the near objects about the pivot of their frame; the far one is skipped, nothing refused', () => {
    const store = createSelectStore(board());
    const source = storeSource(store);
    const ids = ['rect-near', 'rect-near-2', 'rect-far'].map(id);
    const from = selectionFrameOf(ids, source);
    if (from === undefined) throw new Error('no frame');
    const pivot = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const plan = planTransform(
      { type: 'rotate', angle: 0.5, isSnapped: false, pivot, from },
      ids,
      source,
    );
    expect(plan).toMatchObject({ kind: 'rotate', ids: ['rect-near', 'rect-near-2'] });
    if (plan === undefined) throw new Error('no plan');
    const outcome = runTransformPlan(store, ADA, ENVIRONMENT, plan);
    expect(outcome.status).toBe('applied');
    expect(store.get(id('rect-far'))).toMatchObject({ x: 1e300, rotation: 0 });
    expect(store.get(id('rect-near'))?.rotation).toBeCloseTo(0.5, 9);
  });

  it('resizes the near objects to the frame the pointer made; the far one stays', () => {
    const store = createSelectStore(board());
    const source = storeSource(store);
    const ids = ['rect-near', 'rect-near-2', 'rect-far'].map(id);
    const from = selectionFrameOf(ids, source);
    if (from === undefined) throw new Error('no frame');
    const to = { ...from, width: from.width * 2 };
    const plan = planTransform(
      {
        type: 'resize',
        handle: 'e',
        delta: { x: from.width, y: 0 },
        isProportional: false,
        from,
        to,
      },
      ids,
      source,
    );
    expect(plan?.kind).toBe('resize');
    if (plan === undefined) throw new Error('no plan');
    expect(runTransformPlan(store, ADA, ENVIRONMENT, plan).status).toBe('applied');
    expect(store.get(id('rect-far'))).toMatchObject({ x: 1e300, width: 100 });
    expect(store.get(id('rect-near'))).toMatchObject({ width: expect.closeTo(200, 6) as number });
  });

  it('plans nothing when every selected object is far', () => {
    const source = storeSource(createSelectStore(board()));
    expect(
      planTransform({ type: 'nudge', delta: { x: 10, y: 0 } }, [id('rect-far')], source),
    ).toBeUndefined();
  });

  it('a move skips the far one too', () => {
    const store = createSelectStore(board());
    const plan = planTransform(
      { type: 'move', delta: { x: 10, y: 10 }, isAxisLocked: false },
      ['rect-near', 'rect-far'].map(id),
      storeSource(store),
    );
    expect(plan).toMatchObject({ kind: 'move', ids: ['rect-near'] });
  });
});
