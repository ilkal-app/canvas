import { expect, it, vi } from 'vitest';

import { type BoardObject, type ObjectId } from '@canvas/schema';

import { group, id, rect } from './__fixtures__/select-board.js';
import { RootMovePreview } from './root-move-preview.js';
import { previewObjects } from './transform-plan.js';

function sourceOf(objects: readonly BoardObject[]) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return { get: vi.fn((key: ObjectId) => byId.get(key)), childrenOf: () => [] };
}

it('matches ordinary move arithmetic exactly, including signed zeros and large coordinates', () => {
  const coordinates = [0, -0, 0.1, -0.7, 1e12 + 0.125, -1e15];
  for (const x of coordinates)
    for (const y of coordinates) {
      const object = rect('root', null, { x, y, width: 10, height: 20 });
      const source = sourceOf([object]);
      const base = RootMovePreview.create([object.id], source);
      if (!base) throw new Error('Expected a root move');
      for (const delta of [
        { x: 0, y: -0 },
        { x: 0.125, y: -0.3 },
        { x: -1e12, y: 1e12 },
      ]) {
        const next = base.move(delta);
        const expected = previewObjects({ kind: 'move', ids: base.ids, delta }, source)[0];
        if (!expected) throw new Error('Expected ordinary preview');
        expect(Object.is(next.positions[0], expected.x)).toBe(true);
        expect(Object.is(next.positions[1], expected.y)).toBe(true);
        expect(next.get(object.id)).toEqual(expected);
        expect(next.get(object.id)).toBe(next.get(object.id));
        expect(source.get(object.id)).toBe(object);
      }
    }
});

it('retains membership and base geometry, with independent position snapshots and lazy objects', () => {
  const object = rect('root', null, { x: 1, y: 2, width: 10, height: 20 });
  const source = sourceOf([object]);
  const base = RootMovePreview.create([object.id], source);
  if (!base) throw new Error('Expected a root move');
  source.get.mockClear();
  const first = base.move({ x: 3, y: 4 });
  const second = first.move({ x: 5, y: 6 });
  expect(second.ids).toBe(first.ids);
  expect(second.objects).toBe(first.objects);
  expect([...first.positions]).toEqual([4, 6]);
  expect([...second.positions]).toEqual([6, 8]);
  expect(source.get).not.toHaveBeenCalled();
  expect(second.get(id('missing'))).toBeUndefined();
  expect(second.get(object.id)).not.toBe(object);
});

it('refuses missing, nested, duplicate and non-leaf membership atomically', () => {
  const parent = group('parent', null, 0, 0);
  const child = rect('child', 'parent', { x: 0, y: 0, width: 10, height: 10 });
  const root = rect('root', null, { x: 0, y: 0, width: 10, height: 10 });
  const source = sourceOf([parent, child, root]);
  for (const ids of [[], [id('missing')], [root.id, child.id], [root.id, root.id]]) {
    expect(RootMovePreview.create(ids, source)).toBeUndefined();
  }
  // A group root carries its subtree; its child stays in the source.
  expect(RootMovePreview.create([parent.id], source)?.ids).toEqual([parent.id]);
  expect(
    RootMovePreview.create([root.id], { ...source, childrenOf: () => [child.id] }),
  ).toBeUndefined();
});

it('returns to exact document coordinates without rebuilding retained membership', () => {
  const object = rect('root', null, { x: -0, y: 1e12 + 0.125, width: 10, height: 20 });
  const base = RootMovePreview.create([object.id], sourceOf([object]));
  if (!base) throw new Error('Expected a root move');
  const moved = base.move({ x: 20, y: -0.25 });
  const rest = moved.rest();
  expect(rest.ids).toBe(moved.ids);
  expect(rest.objects).toBe(moved.objects);
  expect(Object.is(rest.positions[0], object.x)).toBe(true);
  expect(Object.is(rest.positions[1], object.y)).toBe(true);
  expect(moved.positions).not.toBe(rest.positions);
  expect(moved.positions[0]).toBe(20);
});
