import { expect, it } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import { previewObjects } from './preview-objects.js';

function board(): { readonly parent: BoardObject; readonly child: BoardObject } {
  const objects = createLargeBoardObjects(100, 126);
  const parent = objects.find((object) => object.type === 'frame');
  const child = objects.find((object) => object.parentId === parent?.id);
  if (parent === undefined || child === undefined) throw new Error('Missing fixture hierarchy.');
  return { parent, child };
}

it('retains ancestors and original z keys even when only a child is visible', () => {
  const { parent, child } = board();
  const source = new Map([
    [parent.id, parent],
    [child.id, child],
  ]);
  const result = previewObjects(source, [child.id, child.id]);
  expect(result).toHaveLength(2);
  expect(result).toContainEqual(parent);
  expect(result).toContainEqual(child);
});

it('refuses missing ancestors rather than drawing a child in the wrong coordinate system', () => {
  const { child } = board();
  expect(previewObjects(new Map([[child.id, child]]), [child.id])).toBeUndefined();
});

it('refuses cycles without mutating the source', () => {
  const { parent, child } = board();
  const cyclic = { ...parent, parentId: child.id };
  const source = new Map([
    [parent.id, cyclic],
    [child.id, child],
  ]);
  expect(previewObjects(source, [child.id])).toBeUndefined();
  expect(source.get(parent.id)).toBe(cyclic);
});

it('refuses a missing drawing candidate and accepts an empty viewport', () => {
  const { child } = board();
  expect(previewObjects(new Map(), [child.id])).toBeUndefined();
  expect(previewObjects(new Map(), [])).toEqual([]);
});
