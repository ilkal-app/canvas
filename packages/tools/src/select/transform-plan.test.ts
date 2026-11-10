import { describe, expect, it } from 'vitest';

import type { ChangeSet, YjsDocumentStore } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import { group, id, rect } from './__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  ENVIRONMENT,
  NOW,
  storeSource,
} from './__fixtures__/select-store.js';
import { boxPointToWorld, worldPointToBox, type OrientedBox } from './oriented-box.js';
import { resizeFrame } from './resize-frame.js';
import type { SelectIntent } from './select-intent.js';
import { orientedBoxOf } from './selection-geometry.js';
import {
  planTransform,
  previewObjects,
  runTransformPlan,
  type TransformPlan,
} from './transform-plan.js';

const FRAME_AB: OrientedBox = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

function mustPlan(plan: TransformPlan | undefined): TransformPlan {
  if (plan === undefined) throw new Error('expected a plan');
  return plan;
}

/**
 * Plans an intent, checks its preview is exactly what the command then writes (apart from
 * `updatedAt`), and that the command is one change set.
 *
 * @param intent - The transform intent.
 * @param ids - The selected ids.
 * @param objects - The board; the select board by default.
 * @returns The store after the command, the preview and the change sets delivered.
 */
function commitAndCompare(
  intent: SelectIntent,
  ids: string[],
  objects?: readonly BoardObject[],
): { store: YjsDocumentStore; preview: BoardObject[]; changes: ChangeSet[] } {
  const store = createSelectStore(objects);
  const source = storeSource(store);
  const plan = mustPlan(planTransform(intent, ids.map(id), source));
  const preview = previewObjects(plan, source);
  const changes: ChangeSet[] = [];
  store.subscribe((changeSet) => changes.push(changeSet));
  const outcome = runTransformPlan(store, ADA, ENVIRONMENT, plan);
  expect(outcome.status).toBe('applied');
  expect(changes).toHaveLength(1);
  expect(changes[0]?.origin).toEqual(ADA);
  for (const object of preview) {
    const stored = store.get(object.id);
    expect(stored?.updatedAt).toBe(NOW);
    expectSameObject(stored, object);
  }
  return { store, preview, changes };
}

function expectSameObject(actual: BoardObject | undefined, expected: BoardObject): void {
  expect(actual).toBeDefined();
  for (const key of ['x', 'y', 'rotation', 'width', 'height'] as const) {
    const value = (expected as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number') {
      expect((actual as unknown as Record<string, number>)[key], key).toBeCloseTo(value, 9);
    }
  }
}

describe('planTransform and previewObjects', () => {
  it('moves the movable part of the selection: no locked object, no child of a moved frame', () => {
    const { preview, changes } = commitAndCompare(
      { type: 'move', delta: { x: 10, y: -5 }, isAxisLocked: false },
      ['rect-a', 'frame-f', 'rect-c', 'rect-locked'],
    );
    expect(preview.map((object) => [object.id, object.x, object.y])).toEqual([
      ['rect-a', 10, -5],
      ['frame-f', 410, -5],
    ]);
    expect(changes[0]?.updated).toEqual(['frame-f', 'rect-a']);
  });

  it('moves an object inside a turned group the way it looks on the board', () => {
    const store = createSelectStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('group-h'), { rotation: Math.PI / 2 });
    });
    const source = storeSource(store);
    const plan = mustPlan(
      planTransform(
        { type: 'move', delta: { x: 10, y: 0 }, isAxisLocked: false },
        [id('rect-e')],
        source,
      ),
    );
    // group-h is turned a quarter turn, so board +x is its local −y.
    expect(previewObjects(plan, source)[0]).toMatchObject({ id: 'rect-e' });
    expect(previewObjects(plan, source)[0]?.x).toBeCloseTo(0, 9);
    expect(previewObjects(plan, source)[0]?.y).toBeCloseTo(-10, 9);
  });

  it('resizes several objects with their frame, a turned one along its own axes', () => {
    const to = { ...FRAME_AB, width: 400 };
    const { preview } = commitAndCompare(
      {
        type: 'resize',
        handle: 'e',
        delta: { x: 200, y: 0 },
        isProportional: false,
        from: FRAME_AB,
        to,
      },
      ['rect-a', 'rect-b'],
    );
    const [a, b] = preview;
    expect(a).toMatchObject({ x: 0, y: 0, width: 200, height: 50 });
    // rect-b's centre (175, 50) goes to (350, 50); its local x (world y) keeps 100, its local
    // y (world x) doubles to 100, so its turned corner lands at (400, 0).
    expect(b?.x).toBeCloseTo(400, 9);
    expect(b?.y).toBeCloseTo(0, 9);
    expect(b && 'width' in b ? b.width : Number.NaN).toBeCloseTo(100, 9);
    expect(b && 'height' in b ? b.height : Number.NaN).toBeCloseTo(100, 9);
  });

  it('resizes one turned object to exactly the dragged frame', () => {
    const from: OrientedBox = { x: 200, y: 0, width: 100, height: 50, rotation: Math.PI / 2 };
    const to: OrientedBox = { ...from, x: 190, y: 30, width: 70, height: 60 };
    const { preview } = commitAndCompare(
      { type: 'resize', handle: 'nw', delta: { x: 0, y: 0 }, isProportional: false, from, to },
      ['rect-b'],
    );
    expect(preview[0]?.x).toBeCloseTo(190, 9);
    expect(preview[0]?.y).toBeCloseTo(30, 9);
    const [resized] = preview;
    expect(resized && 'width' in resized ? [resized.width, resized.height] : []).toEqual([
      expect.closeTo(70, 9) as number,
      expect.closeTo(60, 9) as number,
    ]);
  });

  it('resizes a group to the dragged frame by scaling what it holds', () => {
    // group-g's derived box: rect-d at (0, 300) and group-h's rect-e at (60, 300), 40 × 40 each.
    const from: OrientedBox = { x: 0, y: 300, width: 100, height: 40, rotation: 0 };
    expect(orientedBoxOf(id('group-g'), storeSource(createSelectStore()))).toEqual(from);
    const to: OrientedBox = { ...from, x: -10, width: 200, height: 80 };
    const { preview, changes } = commitAndCompare(
      { type: 'resize', handle: 'w', delta: { x: -10, y: 0 }, isProportional: false, from, to },
      ['group-g'],
    );
    expect(Object.fromEntries(preview.map((object) => [object.id, object]))).toMatchObject({
      'group-g': { x: -10, y: 300 },
      'rect-d': { x: 0, y: 0, width: 80, height: 80 },
      'group-h': { x: 120, y: 0 },
      'rect-e': { x: 0, y: 0, width: 80, height: 80 },
    });
    expect(changes[0]?.updated).toEqual(['group-g', 'group-h', 'rect-d', 'rect-e']);
  });

  it('resizes a turned group to the dragged frame, its children exact on the board', () => {
    const objects = [
      group('group-t', null, 100, 50, 0.4),
      rect('rect-t1', 'group-t', { x: 0, y: 0, width: 100, height: 50 }),
      rect('rect-t2', 'group-t', { x: 150, y: 100, width: 50, height: 40 }),
    ];
    const source = storeSource(createSelectStore(objects));
    const from = orientedBoxOf(id('group-t'), source);
    if (from === undefined) throw new Error('expected a box');
    const to = resizeFrame(from, 'se', { x: 30, y: 90 }, false);
    const { store } = commitAndCompare(
      { type: 'resize', handle: 'se', delta: { x: 30, y: 90 }, isProportional: false, from, to },
      ['group-t'],
      objects,
    );
    const after = storeSource(store);
    const [scaleX, scaleY] = [to.width / from.width, to.height / from.height];
    for (const childId of ['rect-t1', 'rect-t2']) {
      const before = orientedBoxOf(id(childId), source);
      const resized = orientedBoxOf(id(childId), after);
      if (!before || !resized) throw new Error('expected boxes');
      // Each child's corner, in the frame's own axes, scales about the frame's corner.
      const inFrame = worldPointToBox(from, before);
      const expected = boxPointToWorld(to, { x: inFrame.x * scaleX, y: inFrame.y * scaleY });
      expect(resized.x).toBeCloseTo(expected.x, 9);
      expect(resized.y).toBeCloseTo(expected.y, 9);
      expect(resized.width).toBeCloseTo(before.width * scaleX, 9);
      expect(resized.height).toBeCloseTo(before.height * scaleY, 9);
      expect(resized.rotation).toBeCloseTo(0.4, 12);
    }
  });

  it('turns the selection about the pivot, each object about it rigidly', () => {
    const { preview } = commitAndCompare(
      {
        type: 'rotate',
        angle: Math.PI / 2,
        isSnapped: false,
        pivot: { x: 50, y: 25 },
        from: FRAME_AB,
      },
      ['rect-a'],
    );
    expect(preview[0]?.x).toBeCloseTo(75, 9);
    expect(preview[0]?.y).toBeCloseTo(-25, 9);
    expect(preview[0]?.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('plans nothing for a gesture that changes nothing or has nothing movable', () => {
    const source = storeSource(createSelectStore());
    const still: SelectIntent = { type: 'move', delta: { x: 0, y: 0 }, isAxisLocked: false };
    expect(planTransform(still, [id('rect-a')], source)).toBeUndefined();
    const moved: SelectIntent = { type: 'move', delta: { x: 1, y: 0 }, isAxisLocked: false };
    expect(planTransform(moved, [id('rect-locked')], source)).toBeUndefined();
    const unturned: SelectIntent = {
      type: 'rotate',
      angle: 0,
      isSnapped: true,
      pivot: { x: 0, y: 0 },
      from: FRAME_AB,
    };
    expect(planTransform(unturned, [id('rect-a')], source)).toBeUndefined();
    const unsized: SelectIntent = {
      type: 'resize',
      handle: 'se',
      delta: { x: 0, y: 0 },
      isProportional: false,
      from: FRAME_AB,
      to: FRAME_AB,
    };
    expect(planTransform(unsized, [id('rect-a')], source)).toBeUndefined();
    expect(planTransform({ type: 'commit' }, [id('rect-a')], source)).toBeUndefined();
  });

  it('resizes only the boxed objects of a selection that holds others', () => {
    const source = storeSource(createSelectStore());
    const plan = planTransform(
      {
        type: 'resize',
        handle: 'e',
        delta: { x: 10, y: 0 },
        isProportional: false,
        from: FRAME_AB,
        to: { ...FRAME_AB, width: 210 },
      },
      [id('rect-a'), id('line-l')],
      source,
    );
    expect(plan?.kind === 'resize' ? plan.boxes.map((box) => box.id) : []).toEqual(['rect-a']);
  });

  it('keeps a zero-width frame’s objects at their width', () => {
    const from: OrientedBox = { x: 0, y: 0, width: 0, height: 50, rotation: 0 };
    const store = createSelectStore();
    const source = storeSource(store);
    const plan = mustPlan(
      planTransform(
        {
          type: 'resize',
          handle: 's',
          delta: { x: 0, y: 50 },
          isProportional: false,
          from,
          to: { ...from, height: 100 },
        },
        [id('rect-a')],
        source,
      ),
    );
    expect(previewObjects(plan, source)[0]).toMatchObject({ width: 100, height: 100 });
  });
});
