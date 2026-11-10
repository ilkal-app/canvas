import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { COLLECT_CHANGES_STAGE } from '../scene/built-in-stages.js';
import { emptyFrameStats, NO_FRAME_TIMERS, type FrameContext } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { Scene } from '../scene/scene.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { ConnectorRouting } from './connector-routing.js';
import { connectorShapeOf } from './connector-shape.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A straight connector from `a` to `b`, both automatic.
 *
 * @param connectorId - Its id.
 * @param fields - Fields to override.
 * @returns The connector.
 */
function linking(connectorId = 'c', fields: Partial<ConnectorObject> = {}): ConnectorObject {
  return {
    ...connectorObject(connectorId),
    from: { kind: 'object', objectId: id('a'), anchor: null },
    to: { kind: 'object', objectId: id('b'), anchor: null },
    ...fields,
  };
}

/**
 * A frame of only `collectChanges` with routing installed, recording each set it applies.
 *
 * @returns The document, the scene and a function running one frame.
 */
function createBench() {
  const scene = new Scene([]);
  const changes = new SceneChangeQueue();
  const applied: SceneChangeSet[] = [];
  const frame = new Frame([COLLECT_CHANGES_STAGE]);
  // A reader under the routing, as the culler and the passes are.
  frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      const drained = context.changes.drain();
      if (drained) {
        applied.push(drained);
        context.changes.push(drained);
      }
      inner.run(context);
    },
  }));
  new ConnectorRouting().install(frame);
  const document = new FakeSceneDocument();
  const run = (set: SceneChangeSet = document.takeChanges()): SceneChangeSet[] => {
    applied.length = 0;
    changes.push(set);
    const stats = emptyFrameStats();
    frame.run({ scene, changes, stats, timers: NO_FRAME_TIMERS } as FrameContext);
    return [...applied];
  };
  return { document, scene, run };
}

/**
 * The connector a change set hands on, and its route.
 *
 * @param set - The change set.
 * @param connectorId - The connector.
 * @returns Its route's points.
 * @throws {Error} When the change set hands on no such connector.
 */
function routeIn(set: SceneChangeSet | undefined, connectorId = 'c') {
  const object = set?.get(id(connectorId));
  if (object?.type !== 'connector') throw new Error(`no connector ${connectorId}`);
  return connectorShapeOf(object).path.route;
}

const A = shapeObject('a', { x: 0, y: 0, width: 100, height: 50 });
const B = shapeObject('b', { x: 300, y: 0, width: 100, height: 50 });

describe('ConnectorRouting', () => {
  it('hands the scene connectors placed on their targets', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    const [set] = bench.run();
    expect(routeIn(set)).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
  });

  it('re-routes a connector when its target moves, in the same collection', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    bench.run();
    bench.document.update('b', { y: 200 });
    const sets = bench.run();
    // The move, then the connector it re-routes.
    expect(sets.map((set) => set.updated)).toEqual([['b'], ['c']]);
    expect(routeIn(sets[1])).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 225 },
    ]);
  });

  it('re-routes connectors on the children of a group that moves', () => {
    const bench = createBench();
    const group = groupObject('g');
    bench.document.create(A, group, { ...B, parentId: group.id }, linking());
    bench.run();
    bench.document.update('g', { x: 0, y: 300 });
    const sets = bench.run();
    expect(sets[1]?.updated).toEqual(['c']);
    expect(routeIn(sets[1]).at(-1)).toEqual({ x: 300, y: 325 });
  });

  it('re-routes a connector on a group when a child moves its bounds', () => {
    const bench = createBench();
    const group = groupObject('g');
    const child = { ...B, parentId: group.id };
    const connector = linking('c', { to: { kind: 'object', objectId: group.id, anchor: null } });
    bench.document.create(A, group, child, connector);
    bench.run();
    bench.document.update('b', { x: 500 });
    const sets = bench.run();
    expect(sets[1]?.updated).toEqual(['c']);
    expect(routeIn(sets[1]).at(-1)).toEqual({ x: 500, y: 25 });
  });

  it('keeps a connector moved rigidly with its targets by their frame, placing nothing again', () => {
    const bench = createBench();
    const frame = frameObject('f', { width: 900, height: 900 });
    const inside = (object: BoardObject): BoardObject => ({ ...object, parentId: frame.id });
    bench.document.create(frame, inside(A), inside(B), inside(linking()));
    const [first] = bench.run();
    bench.document.update('f', { x: 50 });
    const sets = bench.run();
    // The frame's change alone; the scene reads the connector again as its descendant.
    expect(sets).toHaveLength(1);
    expect(sets[0]?.get(id('c'))).toBe(first?.get(id('c')));
  });

  it('re-routes a connector whose frame moves away from a target outside it', () => {
    const bench = createBench();
    const frame = frameObject('f', { x: 0, y: 0, width: 900, height: 900 });
    bench.document.create(frame, { ...A, parentId: frame.id }, B, {
      ...linking(),
      parentId: frame.id,
    });
    bench.run();
    bench.document.update('f', { y: 200 });
    const sets = bench.run();
    // Read again as the frame's descendant, and handed on to readers that skip descendants.
    expect(sets.map((set) => set.updated)).toEqual([['f'], ['c']]);
    // In the frame's own frame A is where it was and B is 200 higher.
    expect(routeIn(sets[1])).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: -175 },
    ]);
  });

  it('measures a group target with a child that joins it in the same change', () => {
    const bench = createBench();
    const group = groupObject('g');
    const first = shapeObject('first', { parentId: group.id, x: 300, y: 0, width: 50, height: 50 });
    const to = { kind: 'object', objectId: group.id, anchor: { x: 1, y: 0.5 } } as const;
    bench.document.create(A, group, first, B, linking('c', { to }));
    bench.run();
    // B joins the group at x 500, so the group spans (300, 0) to (620, 80): right midpoint (620, 40).
    bench.document.update('b', { parentId: group.id, x: 500, width: 120, height: 80 });
    bench.document.update('g', { x: 0 });
    const sets = bench.run();
    expect(sets[1]?.updated).toEqual(['c']);
    expect(routeIn(sets[1]).at(-1)).toEqual({ x: 620, y: 40 });
  });

  it('walks what a frame and a group in it carry once when both change', () => {
    const bench = createBench();
    const frame = frameObject('f', { width: 900, height: 900 });
    const group = groupObject('g', { parentId: frame.id });
    bench.document.create(frame, group, { ...B, parentId: group.id }, A, linking());
    bench.run();
    bench.document.update('f', { x: 10 });
    bench.document.update('g', { x: 5 });
    const sets = bench.run();
    expect(sets.map((set) => set.updated)).toEqual([['f', 'g'], ['c']]);
  });

  it('re-routes a connector its frame carries while its targets outside stay', () => {
    const bench = createBench();
    const frame = frameObject('f', { width: 900, height: 900 });
    bench.document.create(frame, A, B, { ...linking(), parentId: frame.id });
    const [first] = bench.run();
    bench.document.update('f', { y: 100 });
    const sets = bench.run();
    expect(sets.map((set) => set.updated)).toEqual([['f'], ['c']]);
    // The same ends on the board, 100 higher in the moved frame.
    expect(routeIn(sets[1])).toEqual(routeIn(first).map(({ x, y }) => ({ x, y: y - 100 })));
  });

  it('does no connector work for a change nothing is attached to', () => {
    const bench = createBench();
    bench.document.create(A, B, shapeObject('lonely'), linking());
    bench.run();
    bench.document.update('lonely', { x: 900 });
    expect(bench.run()).toHaveLength(1);
  });

  it('hands the same value while a connector and its shape stay the same', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    const [first] = bench.run();
    // B moves along its left side's line: the route is unchanged.
    bench.document.update('b', { x: 300 });
    const sets = bench.run();
    expect(sets[1]?.get(id('c'))).toBe(first?.get(id('c')));
  });

  it("passes a host's root move on as it is and re-routes after it", () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    bench.run();
    bench.document.update('b', { y: 120 });
    const move = markRootMoveChanges(bench.document.takeChanges());
    const sets = bench.run(move);
    expect(sets[0]).toBe(move);
    expect(sets[1]?.updated).toEqual(['c']);
  });

  it('places an end on a deleted target at the origin until the repair detaches it', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    bench.run();
    bench.document.delete('a');
    const sets = bench.run();
    expect(routeIn(sets[1])[0]).toEqual({ x: 0, y: 0 });
  });

  it('forgets connectors that are deleted and stops re-routing them', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    bench.run();
    bench.document.delete('c');
    bench.run();
    bench.document.update('b', { y: 90 });
    expect(bench.run()).toHaveLength(1);
  });

  it('reads objects other than connectors through unchanged', () => {
    const bench = createBench();
    bench.document.create(A, B, linking());
    const [set] = bench.run();
    const read: BoardObject | undefined = set?.get(id('a'));
    expect(read).toBe(bench.document.get(id('a')));
  });
});
