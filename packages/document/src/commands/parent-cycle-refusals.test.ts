// Every command that sets a parent refuses one that would close a parent cycle on the board it
// runs against (cycles arise only from merges, undo and raw writes). A drag into a frame
// is `moveObjects` with a `parentId`; paste and duplicate are `createObjects` (duplicate is the
// app's plan over it); `group` and `connect` give the parent to a new object, which nothing sits
// under yet, so they cannot close one.
import { describe, expect, it } from 'vitest';

import { expectRejected } from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore, nestedFrameObjects } from './__fixtures__/nested-frames.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { moveObjectsCommand } from './move-objects.js';

/**
 * A new frame's `createObject` fields, under a listed id and parent.
 *
 * @param id - Its id.
 * @param parentId - Its parent.
 * @returns The fields.
 * @throws {Error} When the nested-frames board has no `frame-side` (a broken fixture).
 */
function newFrame(id: string, parentId: string | null) {
  const side = nestedFrameObjects().find(({ id: objectId }) => objectId === 'frame-side');
  if (side?.type !== 'frame') throw new Error('the nested-frames board has no frame-side');
  const { width, height, name, background } = side;
  return {
    type: 'frame',
    id,
    parentId,
    x: 0,
    y: 0,
    width,
    height,
    name,
    clip: side.clip,
    background,
  };
}

const codes = (errors: readonly { readonly code: string }[]) => errors.map(({ code }) => code);

describe('commands refuse a parent cycle on their own board', () => {
  it('moveObjects refuses a frame dropped into its own descendant or into itself', () => {
    const store = createNestedFramesStore();
    for (const parentId of ['frame-inner', 'frame-outer']) {
      const errors = expectRejected(store, moveObjectsCommand, {
        moves: [{ id: 'frame-outer', by: { x: 0, y: 0 }, parentId }],
      });
      expect(codes(errors)).toEqual(['parent-cycle']);
    }
  });

  it('createObject refuses an object whose parent is itself', () => {
    const errors = expectRejected(createNestedFramesStore(), createObjectCommand, {
      object: newFrame('frame-new', 'frame-new'),
    });
    expect(codes(errors)).toEqual(['parent-cycle']);
  });

  it('createObjects refuses listed objects that are each other’s parents, or their own', () => {
    const store = createNestedFramesStore();
    const loop = expectRejected(store, createObjectsCommand, {
      objects: [newFrame('a', 'b'), newFrame('b', 'a')],
      parentId: 'frame-inner',
    });
    expect(codes(loop)).toEqual(['parent-cycle', 'parent-cycle']);
    const self = expectRejected(store, createObjectsCommand, {
      objects: [newFrame('a', 'a')],
      parentId: null,
    });
    expect(codes(self)).toEqual(['parent-cycle']);
  });
});
