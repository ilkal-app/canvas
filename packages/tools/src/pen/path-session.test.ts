// The session over one path: no path, another type or a path in a turned group; a
// draft whose creation the document refuses; deleting and finishing drafts, missing and locked
// paths; a refusal other than a lock reported as it is.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { buildNetwork } from './__fixtures__/networks.js';
import { ADA, createPenModeContext, testPath } from './__fixtures__/pen-mode-context.js';
import { PathSession } from './path-session.js';

/** A group at (1000, 0), turned a quarter turn. */
const GROUP: BoardObject = {
  id: 'group' as ObjectId,
  type: 'group',
  parentId: null,
  x: 1000,
  y: 0,
  rotation: Math.PI / 2,
  z: 'a1',
  locked: false,
  createdBy: ADA.principalId,
  createdAt: 1,
  updatedAt: 1,
};

describe('PathSession', () => {
  it('follows no path, or an id that is not a path, as an empty network at the origin', () => {
    const { context } = createPenModeContext([GROUP]);
    const none = new PathSession(context);
    expect(none.path()).toBeUndefined();
    expect(none.network().vertices).toEqual([]);
    expect(none.frame()).toEqual({ cos: 1, sin: 0, x: 0, y: 0 });
    none.preview({ vertices: [], segments: [] });
    none.endPreview();
    expect(new PathSession(context, GROUP.id).path()).toBeUndefined();
  });

  it('converts through a turned parent’s frame', () => {
    const inGroup = testPath({ parentId: GROUP.id, x: 10, y: 0 });
    const { context } = createPenModeContext([GROUP, inGroup]);
    const session = new PathSession(context, inGroup.id);
    const local = session.toLocal({ x: 1000, y: 30 });
    expect(local.x).toBeCloseTo(20, 9);
    expect(local.y).toBeCloseTo(0, 9);
  });

  it('reports a draft the document refuses, and drops drafts on delete and finish', () => {
    const { context } = createPenModeContext([testPath({ id: 'id1' as ObjectId })]);
    const onCommandRefused = vi.fn();
    const session = new PathSession({ ...context, onCommandRefused });
    session.startDraft({ x: 5, y: 5 });
    expect(session.id).toBe('id1');
    const vertices = [{ id: 'v', x: 0, y: 0, mirror: 'none' as const }];
    const empty = { vertices: [], segments: [] };
    // A draft is created only with a segment.
    expect(session.write(empty, { vertices, segments: [] })).toBe('unchanged');
    const dangling = { id: 's', a: 'v', b: 'gone', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    expect(session.write(empty, { vertices, segments: [dangling] })).toBe('refused');
    expect(onCommandRefused).toHaveBeenCalledOnce();
    session.delete();
    expect(session.id).toBeUndefined();
    session.startDraft({ x: 5, y: 5 });
    expect(session.finish()).toBeUndefined();
    expect(session.id).toBeUndefined();
  });

  it('redrafts a path in its frame and style under a new id, and nothing else', () => {
    const path = testPath({ x: 40, y: 60, rotation: 0.5 });
    const { store, context } = createPenModeContext([path]);
    expect(new PathSession(context).redraft()).toBe('unchanged');
    const session = new PathSession(context, path.id);
    expect(session.redraft()).toBe('written');
    expect(store.get(path.id)).toBeUndefined();
    expect(session.id).not.toBe(path.id);
    expect(session.path()).toMatchObject({ x: 40, y: 60, rotation: 0.5, vertices: [] });
    expect(session.frame()).toMatchObject({ x: 40, y: 60, cos: Math.cos(0.5) });
    expect(session.redraft()).toBe('unchanged');
  });

  it('redrafts a path with its dash, join, miter limit and cap', () => {
    const style = {
      strokeDash: { pattern: [8, 8] },
      strokeJoin: 'miter' as const,
      strokeMiterLimit: 8,
      strokeCap: 'square' as const,
    };
    const path = testPath(style);
    const { context } = createPenModeContext([path]);
    const session = new PathSession(context, path.id);
    expect(session.redraft()).toBe('written');
    expect(session.path()).toMatchObject(style);
  });

  it('closes a filled path in the pen style’s dash, join and cap', () => {
    const style = {
      stroke: { color: [0.1, 0.1, 0.1, 1] as [number, number, number, number], width: 2 },
      fill: [1, 0, 0, 1] as [number, number, number, number],
      strokeDash: { pattern: [0, 4] },
      strokeJoin: 'bevel' as const,
      strokeCap: 'round' as const,
    };
    const { context, store } = createPenModeContext();
    const session = new PathSession({ ...context, newPathStyle: () => style });
    session.startDraft({ x: 0, y: 0 });
    const { network } = buildNetwork(
      [
        [0, 0],
        [60, 0],
        [30, 40],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    );
    expect(session.write({ vertices: [], segments: [] }, network)).toBe('written');
    const id = session.id;
    if (id === undefined) throw new Error('The pen path has no id.');
    expect(store.get(id)).toMatchObject({
      fill: [1, 0, 0, 1],
      strokeDash: { pattern: [0, 4] },
      strokeJoin: 'bevel',
      strokeCap: 'round',
    });
  });

  it('finishes a missing path as none and a locked one untouched; deletes nothing gone', () => {
    const { store, context } = createPenModeContext([testPath({ locked: true })]);
    expect(new PathSession(context, 'gone' as ObjectId).finish()).toBeUndefined();
    const before = store.encodeState();
    expect(new PathSession(context, 'path-1' as ObjectId).finish()).toBe('path-1');
    new PathSession(context, 'gone' as ObjectId).delete();
    expect(store.encodeState()).toEqual(before);
  });

  it('reports an edit refused for another reason than a lock, and writes nothing unchanged', () => {
    const path = testPath();
    const { context } = createPenModeContext([path]);
    const onCommandRefused = vi.fn();
    const session = new PathSession({ ...context, onCommandRefused }, path.id);
    expect(session.write(path, path)).toBe('unchanged');
    const dangling = {
      vertices: path.vertices,
      segments: [...path.segments, { ...path.segments[0], id: 's9', b: 'nope' }],
    };
    expect(session.write(path, dangling as typeof path)).toBe('refused');
    expect(onCommandRefused).toHaveBeenCalledOnce();
  });
});
