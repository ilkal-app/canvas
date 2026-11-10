// Written before the export code. CONTRACT: scope chooses drawable objects, their
// placement and instance dependencies, and the exact unpadded world bounds without mutation.
// Deliberately not asserted: menu animation, exact background colour, PNG encoding, PDF.
import { describe, expect, it } from 'vitest';

import {
  createBoard,
  DEFAULT_PAGE,
  type BoardObject,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

import { instanceBoard } from '../collab/__fixtures__/instance-board.js';
import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { exportScopeOf } from './export-scope.js';

const scopeOf = exportScopeOf;

const id = (value: string): ObjectId => value as ObjectId;
const OTHER_PAGE = { id: 'other-page' as PageId, name: 'Other', order: 'a1' };
const idsOf = (objects: readonly BoardObject[]) =>
  new Set(objects.map(({ id: objectId }) => objectId));

function shape(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
): BoardObject {
  return { ...memoryShape(name, 'a0'), x, y, width, height, ...extra } as BoardObject;
}

describe('exportScopeOf', () => {
  it('uses only the shown page roots for the exact board bounds and leaves out pins and other pages', () => {
    const first = shape('first', 10, 20, 100, 50, { pageId: DEFAULT_PAGE.id });
    const second = shape('second', 300, 400, 40, 40, { pageId: DEFAULT_PAGE.id });
    const elsewhere = shape('elsewhere', 900, 900, 20, 20, { pageId: OTHER_PAGE.id });
    const pin = {
      ...shape('pin', 500, 500, 20, 20, { pageId: DEFAULT_PAGE.id }),
      type: 'comment',
      threadId: 'thread',
    } as BoardObject;
    const board = createBoard([first, second, elsewhere, pin], [DEFAULT_PAGE, OTHER_PAGE]);
    const before = structuredClone(board);
    const scope = scopeOf(board, { kind: 'page', pageId: DEFAULT_PAGE.id });
    expect(scope?.kind).toBe('board');
    expect(scope?.rect).toEqual({ x: 10, y: 20, width: 330, height: 420 });
    expect(scope?.shownIds).toEqual(new Set([id('first'), id('second')]));
    expect(idsOf(scope?.objects ?? [])).toEqual(new Set([id('first'), id('second')]));
    expect(board).toEqual(before);
  });

  it('adds ancestors for placement without showing them, and includes descendants when selected', () => {
    const frame = {
      ...shape('frame', 100, 200, 200, 150),
      type: 'frame',
      name: 'Frame',
      clip: false,
      background: [1, 1, 1, 1],
    } as BoardObject;
    const child = shape('child', 10, 20, 30, 40, { parentId: id('frame') });
    const board = createBoard([frame, child]);
    const before = structuredClone(board);
    const childScope = scopeOf(board, { kind: 'selection', ids: [id('child')] });
    expect(childScope).toMatchObject({
      kind: 'selection',
      rect: { x: 110, y: 220, width: 30, height: 40 },
    });
    expect(childScope?.shownIds).toEqual(new Set([id('child')]));
    expect(idsOf(childScope?.objects ?? [])).toEqual(new Set([id('frame'), id('child')]));
    const frameScope = scopeOf(board, { kind: 'selection', ids: [id('frame')] });
    expect(frameScope?.shownIds).toEqual(new Set([id('frame'), id('child')]));
    expect(frameScope?.rect).toEqual({ x: 100, y: 200, width: 200, height: 150 });
    expect(board).toEqual(before);
  });

  it('includes an instance main and its children once without showing them', () => {
    const board = instanceBoard({ hasImages: false });
    const before = structuredClone(board);
    const scope = scopeOf(board, {
      kind: 'selection',
      ids: [id('inst'), id('inst'), id('missing')],
    });
    expect(scope?.shownIds).toEqual(new Set([id('inst')]));
    expect(idsOf(scope?.objects ?? [])).toEqual(
      new Set([id('inst'), id('shelf'), id('main'), id('title')]),
    );
    expect(scope?.objects).toHaveLength(4);
    expect(scope?.rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(board).toEqual(before);
  });

  it('bounds rotated corners rather than the unrotated box', () => {
    const board = createBoard([shape('turned', 100, 200, 100, 50, { rotation: Math.PI / 2 })]);
    expect(scopeOf(board, { kind: 'selection', ids: [id('turned')] })?.rect).toEqual({
      x: 50,
      y: 200,
      width: 50,
      height: 100,
    });
  });

  it('returns no scope for an empty page or unknown and empty selections', () => {
    const board = createBoard([shape('first', 10, 20, 10, 10)], [DEFAULT_PAGE, OTHER_PAGE]);
    expect(scopeOf(board, { kind: 'page', pageId: OTHER_PAGE.id })).toBeUndefined();
    expect(scopeOf(board, { kind: 'selection', ids: [] })).toBeUndefined();
    expect(scopeOf(board, { kind: 'selection', ids: [id('unknown')] })).toBeUndefined();
  });
});
