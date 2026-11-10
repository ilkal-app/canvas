import { describe, expect, it } from 'vitest';

import { DrawableGate } from '../drawable/drawable-gate.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import { getRootMovePlacement } from '../scene/root-move-placement.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { SceneSourceMirror } from './scene-source-mirror.js';

function begun(isOwned = true) {
  const mirror = new SceneSourceMirror(isOwned);
  const object = shapeObject('a');
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([0, 0]),
  });
  return { mirror, object, begin };
}
function update(mirror: SceneSourceMirror, sequence: number, x = sequence): SceneChangeSet {
  const changes = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence,
    positions: new Float64Array([x, -0]),
  });
  if (!changes) throw new Error('Expected an accepted update');
  return changes;
}

describe('private retained placement readers', () => {
  it('attaches only to accepted updates and reads current immutable base and exact positions', () => {
    const { mirror, object, begin } = begun();
    if (!begin) throw new Error('Expected begin');
    expect(getRootMovePlacement(begin)).toBeUndefined();
    const changes = update(mirror, 1, 16_777_217.125);
    const placement = getRootMovePlacement(changes);
    expect(placement).toBe(mirror.retainedMove);
    expect(placement?.objects[0]).toBe(object);
    expect(placement?.positions).toEqual(new Float64Array([16_777_217.125, -0]));
    expect(changes.get(object.id)).toMatchObject({ x: 16_777_217.125, y: -0 });
    expect(object.x).toBe(0);
  });

  it('keeps old change-set reads live while previously returned public objects stay immutable', () => {
    const { mirror, object } = begun();
    const older = update(mirror, 1, 10);
    const oldObject = older.get(object.id);
    const oldPlacement = getRootMovePlacement(older);
    update(mirror, 2, 20);
    expect(getRootMovePlacement(older)).toBe(mirror.retainedMove);
    expect(getRootMovePlacement(older)?.positions[0]).toBe(20);
    expect(oldPlacement?.positions[0]).toBe(10);
    expect(older.get(object.id)?.x).toBe(20);
    expect(oldObject?.x).toBe(10);
    expect(oldObject).not.toBe(older.get(object.id));
  });

  it('rejects stale, wrong-session and wrong-length commands without replacing current placement', () => {
    const { mirror } = begun();
    const changes = update(mirror, 2);
    const before = getRootMovePlacement(changes);
    for (const command of [
      { kind: 'update' as const, session: 1, sequence: 1, positions: new Float64Array([3, 4]) },
      { kind: 'update' as const, session: 2, sequence: 3, positions: new Float64Array([3, 4]) },
      { kind: 'update' as const, session: 1, sequence: 3, positions: new Float64Array([3]) },
    ])
      expect(mirror.applyMove(command)).toBeUndefined();
    expect(getRootMovePlacement(changes)).toBe(before);
  });

  it('exposes replacement membership through older readers and clears on end', () => {
    const { mirror } = begun();
    const older = update(mirror, 1);
    const next = shapeObject('b');
    const begin = mirror.applyMove({
      kind: 'begin',
      session: 2,
      sequence: 0,
      objects: [next],
      positions: new Float64Array([7, 8]),
    });
    if (!begin) throw new Error('Expected begin');
    expect(getRootMovePlacement(begin)).toBeUndefined();
    expect(getRootMovePlacement(older)?.ids).toEqual([next.id]);
    expect(older.updated).not.toEqual(getRootMovePlacement(older)?.ids);
    const end = mirror.applyMove({ kind: 'end', session: 2, sequence: 1 });
    if (!end) throw new Error('Expected end');
    expect(getRootMovePlacement(end)).toBeUndefined();
    expect(getRootMovePlacement(older)).toBeUndefined();
  });

  it('clears live placement on ordinary edits without granting their changes provenance', () => {
    const { mirror, object } = begun();
    const retained = update(mirror, 1);
    const ordinary = mirror.apply({
      created: [],
      updated: [object.id],
      deleted: [],
      objects: { [object.id]: { ...object, x: 90 } },
    });
    expect(getRootMovePlacement(retained)).toBeUndefined();
    expect(getRootMovePlacement(ordinary)).toBeUndefined();
    expect(retained.get(object.id)?.x).toBe(90);
    expect(getRootMovePlacement(markRootMoveChanges(ordinary))).toBeUndefined();
  });

  it('does not copy stronger provenance to retained-only or mixed queue merges', () => {
    const { mirror } = begun();
    const first = update(mirror, 1);
    const second = update(mirror, 2);
    const queue = new SceneChangeQueue();
    queue.push(first);
    expect(queue.drain()).toBe(first);
    for (const last of [
      second,
      {
        created: [],
        updated: [],
        deleted: [],
        get: (id: Parameters<SceneChangeSet['get']>[0]) => second.get(id),
      },
    ]) {
      queue.push(first);
      queue.push(last);
      const merged = queue.drain();
      if (!merged) throw new Error('Expected merged changes');
      expect(getRootMovePlacement(merged)).toBeUndefined();
    }
  });
});

it('reads replacement base geometry even when a newer session reuses the same IDs', () => {
  const { mirror, object } = begun();
  const older = update(mirror, 1);
  const before = getRootMovePlacement(older);
  const replacement = { ...object, width: object.width + 50 };
  mirror.applyMove({
    kind: 'begin',
    session: 2,
    sequence: 0,
    objects: [replacement],
    positions: new Float64Array([4, 5]),
  });
  const current = getRootMovePlacement(older);
  expect(current?.ids).toEqual(older.updated);
  expect(current?.objects).not.toBe(before?.objects);
  expect(current?.objects[0]).toBe(replacement);
});

it('keeps direct/main-thread updates on the ordinary gate path before caller mutation', () => {
  const { mirror, object, begin } = begun(false);
  if (!begin) throw new Error('Expected begin');
  const gate = new DrawableGate();
  gate.filter(begin);
  gate.filter(update(mirror, 1));
  const positions = new Float64Array([12, 13]);
  const changes = mirror.applyMove({ kind: 'update', session: 1, sequence: 2, positions });
  if (!changes) throw new Error('Expected update');
  expect(getRootMovePlacement(changes)).toBeUndefined();
  gate.filter(changes);
  positions[0] = Number.NaN;
  expect(changes.get(object.id)?.x).toBe(12);
});

it('refuses shared positions and invalidates older readers when current positions become shared', () => {
  const { mirror } = begun();
  const older = update(mirror, 1);
  expect(getRootMovePlacement(older)).toBeDefined();
  const positions = new Float64Array(new SharedArrayBuffer(16));
  const current = mirror.applyMove({ kind: 'update', session: 1, sequence: 2, positions });
  if (!current) throw new Error('Expected shared update');
  expect(getRootMovePlacement(current)).toBeUndefined();
  expect(getRootMovePlacement(older)).toBeUndefined();
  const restored = update(mirror, 3);
  expect(getRootMovePlacement(restored)).toBeDefined();
  expect(getRootMovePlacement(older)).toBe(mirror.retainedMove);
});

it('does not grant exclusive ownership by default', () => {
  const mirror = new SceneSourceMirror();
  mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [shapeObject('a')],
    positions: new Float64Array([0, 0]),
  });
  expect(getRootMovePlacement(update(mirror, 1))).toBeUndefined();
});
