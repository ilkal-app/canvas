import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import {
  firstPageIdOf,
  isLivePage,
  orderedPagesOf,
  shownPageIdOf,
  storedPageIdOf,
} from './board-pages.js';
import { comparePages, DEFAULT_PAGE, type Page } from './page.js';

const page = (id: string, order: string): Page => ({ id: id as PageId, name: id, order });

describe('board pages', () => {
  it('reads a board without pages as the virtual default page', () => {
    const board = createBoard([]);
    expect(orderedPagesOf(board)).toEqual([DEFAULT_PAGE]);
    expect(firstPageIdOf(board)).toBe('page-1');
    expect(isLivePage(board, 'page-1')).toBe(true);
    expect(isLivePage(board, 'other')).toBe(false);
    expect(firstPageIdOf(createBoard([], []))).toBe('page-1');
  });

  it('orders pages by key, then id', () => {
    const pages = [page('b', 'a1'), page('c', 'a0'), page('a', 'a1')];
    const board = createBoard([], pages);
    expect(orderedPagesOf(board).map(({ id }) => id)).toEqual(['c', 'a', 'b']);
    expect(firstPageIdOf(board)).toBe('c');
    expect(comparePages(page('x', 'a0'), page('x', 'a0'))).toBe(0);
  });

  it('finds an object page through its root ancestor and shows a dead page as the first', () => {
    const frame = sampleObject('frame', 'frame', { pageId: 'b' as PageId });
    const child = sampleObject('shape', 'child', { parentId: frame.id, pageId: null });
    const lost = sampleObject('shape', 'lost', { pageId: 'gone' as PageId });
    const orphan = sampleObject('shape', 'orphan', { parentId: 'nobody' as ObjectId });
    const loop = sampleObject('group', 'loop', { parentId: 'loop' as ObjectId });
    const board = createBoard(
      [frame, child, lost, orphan, loop],
      [page('a', 'a0'), page('b', 'a1')],
    );
    expect(storedPageIdOf(board, child)).toBe('b');
    expect(shownPageIdOf(board, child)).toBe('b');
    expect(storedPageIdOf(board, lost)).toBe('gone');
    expect(shownPageIdOf(board, lost)).toBe('a');
    expect(storedPageIdOf(board, orphan)).toBeUndefined();
    expect(storedPageIdOf(board, loop)).toBeUndefined();
    expect(shownPageIdOf(board, orphan)).toBe('a');
  });
});
