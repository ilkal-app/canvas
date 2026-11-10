import { expect, it, vi } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';

import { SceneSpatialIndex } from './scene-spatial-index.js';

it('keeps root parent links without rereading each object and still refreshes actual descendants', () => {
  const document = new FakeSceneDocument();
  const parent = shapeObject('root');
  const child = shapeObject('child', { parentId: parent.id, x: 5 });
  document.create(parent, child);
  const ordinary = new SceneSpatialIndex();
  const retained = new SceneSpatialIndex();
  const initial = document.takeChanges();
  ordinary.apply(initial);
  retained.apply(initial);
  document.update(parent.id, { x: 30, y: -0 });
  const changes = document.takeChanges();
  const expected = ordinary.apply(changes);
  const get = vi.fn((id: typeof parent.id) => changes.get(id));
  const result = retained.apply(markRootMoveChanges({ ...changes, get }));
  expect(result).toEqual(expected);
  // Root once for its own bounds and once for the child's world transform; no parent rewrite.
  expect(get.mock.calls.filter(([id]) => id === parent.id)).toHaveLength(2);
  expect(retained.validate()).toEqual([]);
  for (const x of [-1, 30, 40, 100])
    expect(retained.searchPoint({ x, y: 2 })).toEqual(ordinary.searchPoint({ x, y: 2 }));
});
