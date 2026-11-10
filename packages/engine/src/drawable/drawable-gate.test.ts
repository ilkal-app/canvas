import { describe, expect, it } from 'vitest';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { hostileBoard } from './__fixtures__/hostile-board.js';
import { MAX_REPORTED_UNDRAWABLE } from './drawable-extent.js';
import { DrawableGate } from './drawable-gate.js';

/**
 * The ids a change set lists and what its `get` returns for each id asked about.
 *
 * @param changes - The change set.
 * @param ids - The ids to read.
 * @returns The lists and the ids `get` answers.
 */
function viewOf(changes: SceneChangeSet, ids: readonly string[]) {
  return {
    created: [...changes.created],
    updated: [...changes.updated],
    deleted: [...changes.deleted],
    present: ids.filter((id) => changes.get(id as never) !== undefined),
  };
}

describe('DrawableGate', () => {
  it('hands an honest change set on as it is', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), frameObject('f'));
    const changes = document.takeChanges();
    expect(gate.filter(changes)).toBe(changes);
    expect(gate.takeReport().objects).toEqual([]);
  });

  it('hides every undrawable object from what it hands on and reports each once', () => {
    const board = hostileBoard();
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    document.create(...board.objects);
    const filtered = gate.filter(document.takeChanges());
    const ids = board.objects.map((object) => object.id);
    expect(viewOf(filtered, ids).present).toEqual(board.honest.map(({ object }) => object.id));
    expect(new Map(gate.takeReport().objects.map(({ id, reason }) => [id, reason]))).toEqual(
      board.undrawable,
    );
    expect(gate.takeReport().objects).toEqual([]);
    for (const [id] of board.undrawable) expect(gate.isDrawable(id)).toBe(false);
    for (const { object } of board.honest) expect(gate.isDrawable(object.id)).toBe(true);
  });

  it('lists the children a parent’s change turns undrawable or drawable again', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    document.create(frameObject('f'), shapeObject('c', { parentId: 'f' }));
    gate.filter(document.takeChanges());

    document.update('f', { x: Number.NaN });
    const broken = gate.filter(document.takeChanges());
    expect(viewOf(broken, ['f', 'c'])).toEqual({
      created: [],
      updated: ['f', 'c'],
      deleted: [],
      present: [],
    });
    expect(gate.takeReport().objects).toEqual([
      { id: 'f', reason: 'not-finite' },
      { id: 'c', reason: 'undrawable-parent' },
    ]);

    document.update('f', { x: 10 });
    const mended = gate.filter(document.takeChanges());
    expect(viewOf(mended, ['f', 'c'])).toEqual({
      created: [],
      updated: ['f', 'c'],
      deleted: [],
      present: ['f', 'c'],
    });
    expect(gate.takeReport().objects).toEqual([]);
  });

  it('reports an object again only when a change touches it, never per frame', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    document.create(shapeObject('s', { x: 1e308 }), shapeObject('t'));
    gate.filter(document.takeChanges());
    expect(gate.takeReport().objects).toEqual([{ id: 's', reason: 'past-extent' }]);

    document.update('t', { x: 5 });
    gate.filter(document.takeChanges());
    expect(gate.takeReport().objects).toEqual([]);

    document.update('s', { y: 5 });
    gate.filter(document.takeChanges());
    expect(gate.takeReport().objects).toEqual([{ id: 's', reason: 'past-extent' }]);
  });

  it('re-reads no child of a frame that moves within the extent, once its subtree is known', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    const frames = ['f0', 'f1', 'f2'];
    for (const frame of frames) {
      document.create(frameObject(frame));
      for (let index = 0; index < 50; index += 1) {
        document.create(shapeObject(`${frame}-c${String(index)}`, { parentId: frame, x: index }));
      }
    }
    gate.filter(document.takeChanges());
    const read = new Set<string>();
    const move = (dx: number): void => {
      for (const frame of frames) document.update(frame, { x: dx });
      const changes = document.takeChanges();
      read.clear();
      gate.filter({ ...changes, get: (id) => (read.add(id), changes.get(id)) });
    };
    move(10);
    move(20);
    expect([...read].filter((id) => id.includes('-c'))).toEqual([]);
    // A move past the extent still reaches every child.
    move(2 ** 31);
    expect([...read].filter((id) => id.includes('-c'))).toHaveLength(150);
    expect(gate.isDrawable('f0-c1' as never)).toBe(false);
    move(0);
    expect(gate.isDrawable('f0-c1' as never)).toBe(true);
  });

  it('lists at most a thousand undrawable objects in one report, and counts them all', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    const count = MAX_REPORTED_UNDRAWABLE + 500;
    for (let index = 0; index < count; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: Number.NaN }));
    }
    gate.filter(document.takeChanges());
    const report = gate.takeReport();
    expect(report.objects).toHaveLength(MAX_REPORTED_UNDRAWABLE);
    expect(report.count).toBe(count);
    expect(report.objects[0]).toEqual({ id: 's0', reason: 'not-finite' });
    expect(gate.takeReport()).toEqual({ objects: [], count: 0 });
  });

  it('forgets a deleted undrawable object, which the document can still delete', () => {
    const gate = new DrawableGate();
    const document = new FakeSceneDocument();
    document.create(shapeObject('s', { width: -1 }));
    gate.filter(document.takeChanges());
    gate.takeReport();
    document.delete('s');
    const deleted = gate.filter(document.takeChanges());
    expect(deleted.deleted).toEqual(['s']);
    expect(gate.isDrawable('s' as never)).toBe(true);
    expect(gate.takeReport().objects).toEqual([]);
  });
});
