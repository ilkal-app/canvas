import type { Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import type { BoardObject } from '../objects/board-object.js';

import { comparePages, DEFAULT_PAGE, DEFAULT_PAGE_ID, type Page } from './page.js';

/**
 * The board's live pages in page order (`comparePages`): its stored pages, or the default page
 * alone when it holds none. Never empty. Pure; O(p log p).
 *
 * @param board - The board.
 * @returns A new array of its pages, in order.
 */
export function orderedPagesOf(board: Board): Page[] {
  const pages = board.pages;
  if (pages === undefined || pages.size === 0) return [DEFAULT_PAGE];
  return [...pages.values()].sort(comparePages);
}

/**
 * The board's first page: the first live page in page order.
 *
 * @param board - The board.
 * @returns Its id.
 */
export function firstPageIdOf(board: Board): PageId {
  const pages = board.pages;
  if (pages === undefined) return DEFAULT_PAGE_ID;
  let first: Page | undefined;
  for (const page of pages.values()) {
    if (first === undefined || comparePages(page, first) < 0) first = page;
  }
  return first?.id ?? DEFAULT_PAGE_ID;
}

/**
 * Tells whether a page is live on the board: stored, or the virtual default page of a board
 * that stores none.
 *
 * @param board - The board.
 * @param pageId - The page.
 * @returns True when the page is live.
 */
export function isLivePage(board: Board, pageId: string): boolean {
  const pages = board.pages;
  if (pages === undefined || pages.size === 0) return pageId === DEFAULT_PAGE_ID;
  return pages.has(pageId as PageId);
}

/**
 * The page a root object names: its `pageId`, or the default page when it has none (an object
 * stored before pages, read by fallback).
 *
 * @param object - A root object (`parentId: null`).
 * @returns Its page id.
 */
export function rootPageIdOf(object: Pick<BoardObject, 'pageId'>): PageId {
  return object.pageId ?? DEFAULT_PAGE_ID;
}

/**
 * The page an object is on as stored: its root ancestor's page. Cycle-safe.
 * Cost: the object's depth.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The page its root ancestor names, or `undefined` when its chain of parents breaks (a
 *   missing parent) or loops.
 */
export function storedPageIdOf(board: Board, object: BoardObject): PageId | undefined {
  let current = object;
  const walked = new Set<ObjectId>();
  while (current.parentId !== null) {
    if (walked.has(current.id)) return undefined;
    walked.add(current.id);
    const parent = board.objects.get(current.parentId);
    if (parent === undefined) return undefined;
    current = parent;
  }
  return rootPageIdOf(current);
}

/**
 * The page an object is shown on: the page it is on as stored when that page is live, else the
 * first page, where the reference repair puts it (R1 and R2). A viewer, whose
 * client does not write repairs, sees the same.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The page id.
 */
export function shownPageIdOf(board: Board, object: BoardObject): PageId {
  const stored = storedPageIdOf(board, object);
  return stored !== undefined && isLivePage(board, stored) ? stored : firstPageIdOf(board);
}
