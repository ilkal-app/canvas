import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type BoardObject, type ObjectId } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { boundErrorsOf } from './bound-errors.js';
import { overlaySource, type BoxSource } from './box-source.js';
import { judgeExtents, isPastBound } from './extent-rule.js';
import { worldBoundViolations } from './world-bound-check.js';
import { worldBoxOf } from './world-box.js';

const B = BOARD_BOUND;

/**
 * A board of objects as a box source.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(objects: readonly BoardObject[]): BoxSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (id) => byId.get(id),
    childrenOf: (id) => objects.filter(({ parentId }) => parentId === id).map(({ id: key }) => key),
  };
}

/**
 * A shape of the fixture board, placed.
 *
 * @param id - Its id.
 * @param fields - Its placement and size.
 * @returns The shape.
 */
function shape(id: string, fields: Partial<Record<string, unknown>>): BoardObject {
  const base = { ...fixtureObject('shape-box', 'shape'), parentId: null, rotation: 0 };
  return { ...base, id: id as ObjectId, ...fields };
}

/**
 * A group, placed.
 *
 * @param id - Its id.
 * @param x - Its x.
 * @returns The group.
 */
function group(id: string, x: number): BoardObject {
  const base = fixtureObject('group-diagram', 'group');
  return { ...base, id: id as ObjectId, parentId: null, x, y: 0, rotation: 0 };
}

/**
 * The violations of writing objects over a board.
 *
 * @param board - The board before.
 * @param written - The objects written.
 * @returns The violations.
 */
function violationsOf(board: readonly BoardObject[], ...written: BoardObject[]) {
  const before = sourceOf(board);
  const after = overlaySource(before, new Map(written.map((object) => [object.id, object])));
  return worldBoundViolations(
    before,
    after,
    written.map(({ id }) => id),
  );
}

describe('judgeExtents: |after| <= max(B, |before|) per extent', () => {
  const box = (minX: number, maxX: number) =>
    ({ kind: 'box', box: { minX, maxX, minY: 0, maxY: 0 } }) as const;

  it('lets an extent inside go anywhere inside, and one past stay or come in', () => {
    expect(judgeExtents(box(0, 10), box(-B, B))).toEqual({ kind: 'within' });
    expect(judgeExtents(box(0, B + 400), box(0, B + 400))).toEqual({ kind: 'within' });
    expect(judgeExtents(box(0, B + 400), box(0, B + 399))).toEqual({ kind: 'within' });
    expect(judgeExtents(box(0, B + 400), box(0, B + 401))).toEqual({
      kind: 'outward',
      extents: ['maxX'],
    });
    expect(judgeExtents(box(0, B), box(1, B + 1))).toEqual({ kind: 'outward', extents: ['maxX'] });
  });

  it('holds a new object to the bound, and one that cannot be placed after only if it could before', () => {
    expect(judgeExtents(undefined, box(0, B + 1)).kind).toBe('outward');
    expect(judgeExtents(undefined, { kind: 'unplaceable' }).kind).toBe('unplaceable');
    expect(judgeExtents({ kind: 'unplaceable' }, { kind: 'unplaceable' }).kind).toBe('within');
    expect(judgeExtents({ kind: 'unplaceable' }, box(0, B + 1)).kind).toBe('outward');
  });

  it('isPastBound: an extent past B, or no place that can be worked out', () => {
    expect(isPastBound(box(-B, B))).toBe(false);
    expect(isPastBound(box(-B - 1, 0))).toBe(true);
    expect(isPastBound({ kind: 'unplaceable' })).toBe(true);
  });
});

describe('worldBoundViolations', () => {
  it('judges the members a group carries, each by its own box, without walking their chains', () => {
    const board = [
      group('g', -B),
      shape('left', { parentId: 'g', x: 0, y: 0, width: 0, height: 0 }),
      shape('right', { parentId: 'g', x: 2 * B, y: 0, width: 0, height: 0 }),
    ];
    const moved = (x: number) => violationsOf(board, { ...group('g', -B + x) });
    expect(moved(0)).toEqual([]);
    expect(moved(10).map(({ objectId }) => objectId)).toEqual(['right']);
    // The group's own origin, at -B, goes out with it (placement is bounded too).
    expect(moved(-10).map(({ objectId }) => objectId)).toEqual(['g', 'left']);
  });

  it('skips an object whose geometry and place did not change, and one deleted', () => {
    const far = shape('far', { x: 1e300 });
    const restyled = { ...far, fill: [0, 0, 0, 1] } as BoardObject;
    expect(violationsOf([far], restyled)).toEqual([]);
    const before = sourceOf([far]);
    const after = overlaySource(before, new Map([[far.id, null]]));
    expect(worldBoundViolations(before, after, [far.id])).toEqual([]);
  });

  it('refuses a value raised past its limit, and takes one kept or lowered past it', () => {
    const rounded = shape('s', { cornerRadius: 10 });
    const raised = violationsOf([rounded], { ...rounded, cornerRadius: B + 1 } as BoardObject);
    expect(raised).toMatchObject([{ kind: 'value', objectId: 's', before: undefined }]);
    const past = shape('s', { cornerRadius: 1e300 });
    expect(violationsOf([past], { ...past, cornerRadius: 1e299 } as BoardObject)).toEqual([]);
    expect(violationsOf([past], { ...past, cornerRadius: 1e301 } as BoardObject)).toMatchObject([
      { kind: 'value', before: 1e300 },
    ]);
  });

  it('refuses a move that leaves an object with no place, and takes one that gives it back a place', () => {
    const board = [
      { ...group('bad', 0), x: Number.POSITIVE_INFINITY },
      shape('s', { parentId: 'bad', x: 0, y: 0, width: 5, height: 5 }),
      shape('free', { x: 0, y: 0, width: 5, height: 5 }),
    ];
    const lost = violationsOf(board, shape('free', { parentId: 'bad', width: 5, height: 5 }));
    expect(lost).toMatchObject([{ kind: 'extent', verdict: { kind: 'unplaceable' } }]);
    expect(boundErrorsOf(lost)).toMatchObject([
      {
        code: 'invalid-input',
        objectId: 'free',
        path: [],
        message: expect.stringContaining('no place on the board that can be worked out') as string,
      },
    ]);
    expect(
      violationsOf(board, shape('s', { parentId: null, x: 3, y: 3, width: 5, height: 5 })),
    ).toEqual([]);
    const under = shape('s', { parentId: 'bad', x: 0, y: 0, width: 5, height: 5 });
    expect(isPastBound(worldBoxOf(sourceOf(board), under))).toBe(true);
  });

  it('agrees with worldBoxOf far from the origin, where the order of composition decides overflow', () => {
    // Sync fuzz, run seed 919 (hostile, raw writes and select-tool transforms), iteration 15: a
    // frame placed back near the origin by a group far out, holding a connector a peer stored at
    // -1e308, turned about a point near the origin. Composed from the connector up, its place
    // overflowed while the walk down from the frame did not, so the model and the command
    // disagreed; both now compose from the top of the chain down.
    const frame = {
      ...fixtureObject('frame-plan', 'frame'),
      id: 'f' as ObjectId,
      parentId: 'g' as ObjectId,
      x: 8.913089376870335e307,
      y: 4.533964905016491e307,
      rotation: 0,
    };
    const connector = {
      ...fixtureObject('connector-flow', 'connector'),
      id: 'c' as ObjectId,
      parentId: 'f' as ObjectId,
      x: -1e308,
      y: 0,
      rotation: 1e300,
    };
    const board = [
      { ...group('g', -8.913089376870335e307), y: -4.533964905016491e307 },
      frame,
      connector,
    ] as BoardObject[];
    const turned = { ...frame, rotation: 2.748893571891069 } as BoardObject;
    const before = sourceOf(board);
    const after = overlaySource(before, new Map([[turned.id, turned]]));
    const judged = worldBoundViolations(before, after, [turned.id]);
    // The walk down and the rule on `worldBoxOf` decide alike (the connector's box holds its
    // origin, far out, since).
    const verdict = judgeExtents(worldBoxOf(before, connector), worldBoxOf(after, connector));
    expect(judged.some(({ objectId }) => objectId === 'c')).toBe(verdict.kind !== 'within');
  });
});
