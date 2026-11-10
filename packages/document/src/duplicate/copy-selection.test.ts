import { describe, expect, it } from 'vitest';

import {
  compareSiblings,
  exportBoard,
  importBoard,
  rootPageIdOf,
  type ObjectId,
} from '@canvas/schema';

import { clipboardBoard, objectOf } from './__fixtures__/clipboard-board.js';
import { copySelection } from './copy-selection.js';

/**
 * Copies a selection of the fixture board.
 *
 * @param ids - The selected ids.
 * @returns The copy.
 * @throws {Error} When nothing was copied.
 */
function copyOf(...ids: string[]) {
  const copied = copySelection(clipboardBoard(), ids as ObjectId[]);
  if (copied === undefined) throw new Error('nothing was copied');
  return copied;
}

describe('copySelection', () => {
  it('copies the selection with its descendants, as a board importBoard accepts', () => {
    const copied = copyOf('group');
    expect([...copied.objects.keys()].sort()).toEqual(['group', 'left', 'right']);
    expect(() => importBoard(JSON.parse(JSON.stringify(exportBoard(copied))))).not.toThrow();
  });

  it('puts a root taken from a frame on the frame’s page, which it was on', () => {
    const frame = objectOf(clipboardBoard(), 'frame');
    expect(objectOf(copyOf('group'), 'group').pageId).toBe(rootPageIdOf(frame));
  });

  it('moves each root to the board root where it is on the board, children unchanged', () => {
    const copied = copyOf('group');
    // The frame at (1000, 0) is turned a quarter turn: the group's (100, 50) in it is (950, 100).
    const group = objectOf(copied, 'group');
    expect(group.parentId).toBeNull();
    expect(group.x).toBeCloseTo(950, 9);
    expect(group.y).toBeCloseTo(100, 9);
    expect(group.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(objectOf(copied, 'left')).toEqual(objectOf(clipboardBoard(), 'left'));
  });

  it('detaches connector ends on objects not copied, where they were, and keeps the rest', () => {
    const copied = copyOf('group', 'link');
    const link = objectOf(copied, 'link');
    if (link.type !== 'connector') throw new Error('the link is a connector');
    expect(link.from).toEqual({ kind: 'object', objectId: 'left', anchor: null });
    // The end was on the outside shape's right edge, halfway down: (40, 10).
    expect(link.to).toEqual({ kind: 'point', x: 40, y: 10 });
    const both = objectOf(copyOf('group', 'link', 'outside'), 'link');
    expect(both).toMatchObject({ to: { kind: 'object', objectId: 'outside' } });
  });

  it('takes an object selected with its ancestor once, and leaves comments out', () => {
    expect([...copyOf('group', 'left').objects.keys()].sort()).toEqual(['group', 'left', 'right']);
    expect([...copyOf('pin', 'title').objects.keys()]).toEqual(['title']);
    expect(copySelection(clipboardBoard(), ['pin', 'missing'] as ObjectId[])).toBeUndefined();
    expect(copySelection(clipboardBoard(), [])).toBeUndefined();
  });

  it('stacks the roots in the order the board painted them, with fresh keys', () => {
    const copied = copyOf('photo', 'title', 'outside', 'group');
    const roots = [...copied.objects.values()].filter((object) => object.parentId === null);
    // The frame (holding the group) paints below the outside shape, the title, then the photo.
    expect([...roots].sort(compareSiblings).map(({ id }) => id)).toEqual([
      'group',
      'outside',
      'title',
      'photo',
    ]);
  });

  it('keeps an image’s asset and a text’s runs, and never modifies the board', () => {
    const board = clipboardBoard();
    const copied = copySelection(board, ['photo', 'title'] as ObjectId[]) ?? board;
    const title = objectOf(board, 'title');
    expect(objectOf(copied, 'photo')).toMatchObject({ assetId: 'asset-photo' });
    expect(objectOf(copied, 'title')).toMatchObject({
      text: 'Bold 👋 plain',
      runs: 'runs' in title ? title.runs : [],
    });
    expect(board).toEqual(clipboardBoard());
  });
});
