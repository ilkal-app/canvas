import { z } from 'zod';

import { pageIdSchema, type PageId } from '../ids/page-id.js';
import { compareKeys } from '../z-order/compare-keys.js';
import { zKeySchema } from '../z-order/z-key-schema.js';

/**
 * The most live pages a board may be given by `addPage` or `duplicatePage`: a
 * creation limit, not an invariant. Concurrent adds may take a board past it; every page and
 * object is then kept, and `validateBoard` reports a notice (`page-count`).
 */
export const MAX_PAGES = 100;

/** The longest page name, in UTF-16 code units, like a frame's name. */
export const MAX_PAGE_NAME_LENGTH = 200;

/**
 * The id of the page every board has before a page command touches it, and of the page every
 * root object stored before layout 4 is on. Part of the stored format; never changes.
 */
export const DEFAULT_PAGE_ID = 'page-1' as PageId;

/** The name of the default page when nobody renamed it. Part of the stored format. */
export const DEFAULT_PAGE_NAME = 'Page 1';

/** The order key of the default page when nobody reordered it: the key generator's first key. */
export const DEFAULT_PAGE_ORDER = 'a0';

/**
 * Validates a page: its id, its name (at most {@link MAX_PAGE_NAME_LENGTH}
 * code units) and its order, a fractional-index key; equal keys are ordered by id.
 */
export const pageSchema = z.strictObject({
  /** The page id, unique within the board. */
  id: pageIdSchema,
  /** The page's name, shown in the page list. */
  name: z
    .string()
    .max(MAX_PAGE_NAME_LENGTH)
    .describe(`The page name, at most ${String(MAX_PAGE_NAME_LENGTH)} characters.`),
  /** The page's place in the board's page order: a fractional-index key, ties by id. */
  order: zKeySchema.describe('Fractional-index key ordering the pages; equal keys by id.'),
});

/** A page of a board. */
export type Page = z.output<typeof pageSchema>;

/** The default page, as a board without stored pages reads it. */
export const DEFAULT_PAGE: Page = Object.freeze({
  id: DEFAULT_PAGE_ID,
  name: DEFAULT_PAGE_NAME,
  order: DEFAULT_PAGE_ORDER,
});

/**
 * The page order: by `order` (UTF-16 code units), then by id. Usable as an `Array#sort`
 * comparator. Pure.
 *
 * @param first - One page.
 * @param second - The other.
 * @returns A negative number when `first` comes first, positive when after, else 0.
 */
export function comparePages(
  first: Pick<Page, 'id' | 'order'>,
  second: Pick<Page, 'id' | 'order'>,
): number {
  return compareKeys(first.order, second.order) || compareKeys(first.id, second.id);
}
