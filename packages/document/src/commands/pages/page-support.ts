import {
  MAX_PAGE_NAME_LENGTH,
  MAX_PAGES,
  rootPageIdOf,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

import { firstPageIn } from '../../pages/page-map.js';
import { generateKeyBetween } from '../../z-order/fractional-key.js';
import { pagesOf } from '../command-checks.js';
import { commandError, type CommandError } from '../command-error.js';
import type { BoardReader } from '../command.js';

// What the page commands share: the board's pages as the client has
// them, the refusals, order keys between neighbours, default names and a page's objects.

/**
 * The board's live pages as a list in page order.
 *
 * @param board - The board before the command.
 * @returns The pages, in order; never empty.
 */
export function pageList(board: BoardReader): Page[] {
  return [...pagesOf(board).values()];
}

/**
 * Looks a page up, refusing a page that is not live.
 *
 * @param board - The board before the command.
 * @param pageId - The page.
 * @param path - Where the input names it.
 * @param errors - Where to add the refusal.
 * @returns The page, or `undefined` (a `missing-page` error added).
 */
export function livePage(
  board: BoardReader,
  pageId: PageId,
  path: readonly (string | number)[],
  errors: CommandError[],
): Page | undefined {
  const page = pagesOf(board).get(pageId);
  if (page === undefined) {
    errors.push(commandError('missing-page', null, path, `there is no page "${pageId}"`));
  }
  return page;
}

/**
 * The refusal of a page creation on a board of `MAX_PAGES` or more live pages (a creation limit:
 * concurrent adds may have taken the board past it).
 *
 * @param board - The board before the command.
 * @returns The refusal, or `undefined` when a page may be added.
 */
export function pageLimitError(board: BoardReader): CommandError | undefined {
  const count = pagesOf(board).size;
  if (count < MAX_PAGES) return undefined;
  const message = `This board has ${String(count)} pages; the limit is ${String(MAX_PAGES)}`;
  return commandError('too-many-pages', null, [], message);
}

/**
 * An order key between two neighbouring pages' keys: above `lower`, below the lowest key above
 * it (equal keys are ordered by id, so a tie is stepped over).
 *
 * @param pages - The pages, in order.
 * @param lower - The key to sort above, or `null` for the front.
 * @param upper - The key to sort below, or `null` for the back.
 * @param path - Where the input names the neighbour, for the refusal.
 * @param errors - Where to add a refusal when no key fits.
 * @returns The key, or `undefined` (an `unorderable-neighbours` error added).
 */
export function orderBetween(
  pages: readonly Page[],
  lower: string | null,
  upper: string | null,
  path: readonly (string | number)[],
  errors: CommandError[],
): string | undefined {
  try {
    return generateKeyBetween(lower, upper);
  } catch {
    const message = `no order key fits between ${String(lower)} and ${String(upper)} among ${String(pages.length)} pages`;
    errors.push(commandError('unorderable-neighbours', null, path, message));
    return undefined;
  }
}

/**
 * The key of the first page that sorts strictly after a key.
 *
 * @param pages - The pages, in order.
 * @param key - The key.
 * @returns The next higher key, or `null` when none is higher.
 */
export function nextOrderAbove(pages: readonly Page[], key: string): string | null {
  return pages.find(({ order }) => order > key)?.order ?? null;
}

/**
 * The key of the last page that sorts strictly before a key.
 *
 * @param pages - The pages, in order.
 * @param key - The key.
 * @returns The next lower key, or `null` when none is lower.
 */
export function nextOrderBelow(pages: readonly Page[], key: string): string | null {
  let below: string | null = null;
  for (const { order } of pages) if (order < key) below = order;
  return below;
}

/**
 * The name of a new page: `Page N`, the smallest N from 1 not in use.
 *
 * @param pages - The pages.
 * @returns The name.
 */
export function defaultPageName(pages: readonly Page[]): string {
  const names = new Set(pages.map(({ name }) => name));
  let index = 1;
  while (names.has(`Page ${String(index)}`)) index += 1;
  return `Page ${String(index)}`;
}

/**
 * The name of a page's copy: `<name> copy`, cut to `MAX_PAGE_NAME_LENGTH`.
 *
 * @param name - The source page's name.
 * @returns The copy's name.
 */
export function copyName(name: string): string {
  const suffix = ' copy';
  return `${name.slice(0, MAX_PAGE_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * The page a root object is on, as the board shows it: its own when live, else the first page,
 * where the repair puts it (R1).
 *
 * @param pages - The live pages, in order.
 * @param object - A root object.
 * @returns The page.
 */
export function shownRootPage(pages: ReadonlyMap<PageId, Page>, object: BoardObject): PageId {
  const pageId = rootPageIdOf(object);
  return pages.has(pageId) ? pageId : firstPageIn(pages);
}

/**
 * The page an object is on, as the board shows it: its root ancestor's (`shownRootPage`).
 *
 * @param board - The board.
 * @param object - The object, or `undefined`.
 * @returns The page, or `undefined` for no object or a chain of parents that breaks or loops.
 */
export function pageOfObject(
  board: BoardReader,
  object: BoardObject | undefined,
): PageId | undefined {
  const walked = new Set<ObjectId>();
  let current = object;
  while (current !== undefined && current.parentId !== null) {
    if (walked.has(current.id)) return undefined;
    walked.add(current.id);
    current = board.get(current.parentId);
  }
  return current === undefined ? undefined : shownRootPage(pagesOf(board), current);
}

/**
 * The root objects on a page, and every object on it, through the reverse index of children.
 * Cost: the board's root objects plus the page's objects.
 *
 * @param board - The board before the command.
 * @param pageId - The page.
 * @returns The page's root objects, sorted by id, and all of its objects, roots first.
 */
export function objectsOnPage(
  board: BoardReader,
  pageId: PageId,
): { readonly roots: ObjectId[]; readonly all: ObjectId[] } {
  const pages = pagesOf(board);
  const roots = [...board.references.childrenOf(null)]
    .filter((id) => {
      const object = board.get(id);
      return object !== undefined && shownRootPage(pages, object) === pageId;
    })
    .sort();
  const all: ObjectId[] = [];
  const seen = new Set<ObjectId>();
  const pending = [...roots].reverse();
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    all.push(id);
    pending.push(...board.references.childrenOf(id));
  }
  return { roots, all };
}
