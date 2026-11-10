import { expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { frame, group, id, mapSource, rect } from './__fixtures__/select-board.js';
import { RootMovePreview } from './root-move-preview.js';
import { previewObjects } from './transform-plan.js';

it('previews only top-level frame and group roots while their descendants stay in the source', () => {
  const objects = [
    frame('frame', null, { x: 20.125, y: -10.5, width: 100, height: 100 }),
    group('nested', 'frame', 5, 7),
    rect('child', 'nested', { x: 3, y: 4, width: 10, height: 10 }),
    group('root-group', null, -30, 40),
    rect('group-child', 'root-group', { x: 1, y: 2, width: 10, height: 10 }),
  ];
  const source = mapSource(objects);
  const roots = [id('frame'), id('root-group')];
  const base = RootMovePreview.create(roots, source);
  if (!base) throw new Error('Expected retained subtree preview');
  const moved = base.move({ x: 0.3, y: -7.25 });
  const ordinary = previewObjects(
    { kind: 'move', ids: roots, delta: { x: 0.3, y: -7.25 } },
    source,
  );
  expect(moved.ids).toEqual(roots);
  expect(moved.objects).toEqual([objects[0], objects[3]]);
  expect([...moved.positions]).toEqual(ordinary.flatMap(({ x, y }) => [x, y]));
  expect(moved.get(id('child'))).toBeUndefined();
  expect(moved.get(id('group-child'))).toBeUndefined();
  expect(moved.get(id('frame'))).toEqual(ordinary[0]);
  expect(moved.get(id('root-group'))).toEqual(ordinary[1]);
});

it('refuses clipping frames, instances, and a selection containing its own descendant', () => {
  const base = frame('frame', null, { x: 0, y: 0, width: 100, height: 100 });
  const child = rect('child', 'frame', { x: 5, y: 5, width: 10, height: 10 });
  const clipping = { ...frame('clip', null, { x: 0, y: 0, width: 100, height: 100 }), clip: true };
  const instance: BoardObject = {
    ...group('instance', null, 0, 0),
    type: 'instance',
    mainId: id('main'),
    overrides: {},
    width: 100,
    height: 100,
  };
  const source = mapSource([base, child, clipping, instance]);
  for (const ids of [[clipping.id], [instance.id], [base.id, child.id]]) {
    expect(RootMovePreview.create(ids, source)).toBeUndefined();
    expect(previewObjects({ kind: 'move', ids, delta: { x: 2, y: 3 } }, source)).toHaveLength(
      ids.length,
    );
  }
});
