import { expect, it, vi } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { hostileBoard } from './__fixtures__/hostile-board.js';
import { DRAWABLE_EXTENT } from './drawable-extent.js';
import { DrawableGate } from './drawable-gate.js';

it('does not reread invariant style fields during proven root moves', () => {
  const gate = new DrawableGate();
  const fill = vi.fn((): [number, number, number, number] => [1, 0, 0, 1]);
  let object = shapeObject('shape');
  const changes = (): SceneChangeSet => ({
    created: [],
    updated: [object.id],
    deleted: [],
    get: () => object,
  });
  gate.filter(changes());
  object = {
    ...object,
    x: 1,
    get fill() {
      return fill();
    },
  };
  gate.filter(markRootMoveChanges(changes()));
  expect(fill).toHaveBeenCalled();
  object = {
    ...object,
    x: 2,
    get fill() {
      return fill();
    },
  };
  fill.mockClear();
  gate.filter(markRootMoveChanges(changes()));
  expect(fill).not.toHaveBeenCalled();
});

it('matches ordinary verdicts and reports through movement, repairs, deletion and reuse', () => {
  const fast = new DrawableGate();
  const ordinary = new DrawableGate();
  const document = new FakeSceneDocument();
  const board = hostileBoard();
  document.create(...board.objects);
  const compare = (changes: SceneChangeSet, isMove: boolean) => {
    const control = ordinary.filter({ ...changes });
    const result = fast.filter(isMove ? markRootMoveChanges(changes) : changes);
    expect(result.created).toEqual(control.created);
    expect(result.updated).toEqual(control.updated);
    expect(result.deleted).toEqual(control.deleted);
    for (const object of board.objects) {
      expect(result.get(object.id)).toEqual(control.get(object.id));
      expect(fast.isDrawable(object.id)).toBe(ordinary.isDrawable(object.id));
    }
    expect(fast.undrawableCount).toBe(ordinary.undrawableCount);
    expect(fast.takeReport()).toEqual(ordinary.takeReport());
  };
  compare(document.takeChanges(), false);
  const roots = board.objects.filter(
    (object) => object.parentId === null && object.type !== 'frame' && object.type !== 'group',
  );
  for (const x of [12.125, Number.NaN, DRAWABLE_EXTENT, -DRAWABLE_EXTENT, 0]) {
    for (const object of roots) document.update(object.id, { x, y: x / 2 });
    compare(document.takeChanges(), true);
  }
  const shape = roots.find((object) => object.type === 'shape');
  if (!shape) throw new Error('fixture requires a root shape');
  document.update(shape.id, { width: -1 });
  compare(document.takeChanges(), false);
  document.update(shape.id, { x: Number.NaN });
  compare(document.takeChanges(), true);
  document.update(shape.id, { x: 0 });
  compare(document.takeChanges(), true);
  document.update(shape.id, { width: 10 });
  compare(document.takeChanges(), false);
  document.update(shape.id, { x: 1 });
  compare(document.takeChanges(), true);
  document.delete(shape.id);
  compare(document.takeChanges(), false);
  document.create(shapeObject(shape.id, { width: -1 }));
  compare(document.takeChanges(), false);
  document.update(shape.id, { x: 2 });
  compare(document.takeChanges(), true);
});

it('falls back for a nominal leaf with real children and for unproven geometry changes', () => {
  const document = new FakeSceneDocument();
  const fast = new DrawableGate();
  const ordinary = new DrawableGate();
  const parent = shapeObject('parent');
  const child = shapeObject('child', { parentId: parent.id });
  document.create(parent, child);
  const compare = (changes: SceneChangeSet, isMove: boolean) => {
    const expected = ordinary.filter({ ...changes });
    const actual = fast.filter(isMove ? markRootMoveChanges(changes) : changes);
    expect(actual.updated).toEqual(expected.updated);
    for (const id of [parent.id, child.id]) expect(actual.get(id)).toEqual(expected.get(id));
    expect(fast.takeReport()).toEqual(ordinary.takeReport());
  };
  compare(document.takeChanges(), false);
  for (const x of [Number.NaN, 10, DRAWABLE_EXTENT, 0]) {
    document.update(parent.id, { x });
    compare(document.takeChanges(), true);
  }
  document.update(parent.id, { width: -1 });
  compare(document.takeChanges(), false);
  document.update(parent.id, { x: 2 });
  compare(document.takeChanges(), true);
});

it('judges a previously unknown ID ordinarily even when its update carries provenance', () => {
  const gate = new DrawableGate();
  let object = shapeObject('unknown', { width: -1 });
  const changes = (): SceneChangeSet => ({
    created: [],
    updated: [object.id],
    deleted: [],
    get: () => object,
  });
  expect(gate.filter(markRootMoveChanges(changes())).get(object.id)).toBeUndefined();
  expect(gate.takeReport().objects).toEqual([{ id: object.id, reason: 'negative-size' }]);
  object = { ...object, width: 10 };
  expect(gate.filter(changes()).get(object.id)).toBe(object);
  object = { ...object, x: 12 };
  expect(gate.filter(markRootMoveChanges(changes())).get(object.id)).toBe(object);
  expect(gate.takeReport().count).toBe(0);
});
