import * as Y from 'yjs';

import {
  comparePages,
  DEFAULT_PAGE,
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_NAME,
  DEFAULT_PAGE_ORDER,
  isPageIdText,
  isValidKey,
  MAX_PAGE_NAME_LENGTH,
  type Page,
  type PageId,
} from '@canvas/schema';

// The stored layout of pages (layout 4): a top-level `Y.Map` named `pages`, one
// plain value per key, three keys per page, so that a rename and a reorder of one page merge:
// `<pageId>.identity` (`{ id, createdBy, createdAt }`; the page exists iff this key does),
// `<pageId>.name` and `<pageId>.order`. A board with no `.identity` key at all has one page, the
// virtual `page-1`; a page command first writes `page-1.identity` with the same value on every
// client. A `.name` or `.order` without its `.identity` (a rename concurrent with the page's
// delete) is ignored. This name and these keys are part of the persisted document format.

/** The name of the document's top-level map of pages. Part of the persisted format. */
export const PAGES_MAP_NAME = 'pages';

/** The three keys of a page, by field. */
export const PAGE_FIELDS = ['identity', 'name', 'order'] as const;

/** One of {@link PAGE_FIELDS}. */
export type PageField = (typeof PAGE_FIELDS)[number];

/** What a page's `.identity` key holds. */
export interface PageIdentity {
  /** The page id, equal to the key's id part. */
  readonly id: PageId;
  /** Who created the page; `null` for the materialised default page. */
  readonly createdBy: string | null;
  /** When it was created, ms since the epoch; 0 for the materialised default page. */
  readonly createdAt: number;
}

/** The identity every client writes when it materialises the virtual default page. */
export const DEFAULT_PAGE_IDENTITY: PageIdentity = Object.freeze({
  id: DEFAULT_PAGE_ID,
  createdBy: null,
  createdAt: 0,
});

/**
 * The key of one field of a page.
 *
 * @param pageId - The page.
 * @param field - The field.
 * @returns `<pageId>.<field>`.
 */
export function pageKey(pageId: string, field: PageField): string {
  return `${pageId}.${field}`;
}

/**
 * Splits a key of the pages map.
 *
 * @param key - A key, as any peer may have written it.
 * @returns The page id and field, or `undefined` for a key of no page field.
 */
export function parsePageKey(key: string): { pageId: PageId; field: PageField } | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const pageId = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!isPageIdText(pageId) || !(PAGE_FIELDS as readonly string[]).includes(field)) {
    return undefined;
  }
  return { pageId, field: field as PageField };
}

/**
 * Tells whether a value is an identity for a page (the door's rule): a record
 * whose `id` is the page's.
 *
 * @param value - The stored value.
 * @param pageId - The page whose key holds it.
 * @returns True for a page identity.
 */
export function isPageIdentity(value: unknown, pageId: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Y.AbstractType) &&
    (value as { readonly id?: unknown }).id === pageId
  );
}

/**
 * Tells whether a value is a page name the door and the store accept.
 *
 * @param value - The value.
 * @returns True for a string of at most `MAX_PAGE_NAME_LENGTH` code units.
 */
export function isPageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PAGE_NAME_LENGTH;
}

/**
 * Tells whether a value is a page order the door and the store accept.
 *
 * @param value - The value.
 * @returns True for a valid fractional-index key.
 */
export function isPageOrder(value: unknown): value is string {
  return typeof value === 'string' && isValidKey(value);
}

/**
 * Tells whether a pages map stores any page: whether one `.identity` key exists.
 *
 * @param map - The pages map.
 * @returns True when the board's pages are stored, false while Page 1 is virtual.
 */
export function hasStoredPages(map: Y.Map<unknown>): boolean {
  for (const key of map.keys()) {
    const parsed = parsePageKey(key);
    if (parsed?.field === 'identity' && isPageIdentity(map.get(key), parsed.pageId)) return true;
  }
  return false;
}

/**
 * Reads the board's live pages from the pages map, in page order (`comparePages`): every page
 * whose `.identity` key holds its identity, its name and order read from their keys (an absent or
 * unreadable value reads as the default page's for `page-1`, as an empty name and the first key
 * otherwise); the virtual default page alone when there is none.
 *
 * @param map - The pages map.
 * @returns The pages by id, inserted in page order; never empty.
 */
export function readPages(map: Y.Map<unknown>): Map<PageId, Page> {
  const pages: Page[] = [];
  for (const key of map.keys()) {
    const parsed = parsePageKey(key);
    if (parsed?.field !== 'identity' || !isPageIdentity(map.get(key), parsed.pageId)) continue;
    const { pageId } = parsed;
    const name = map.get(pageKey(pageId, 'name'));
    const order = map.get(pageKey(pageId, 'order'));
    const isDefault = pageId === DEFAULT_PAGE_ID;
    pages.push(
      Object.freeze({
        id: pageId,
        name: isPageName(name) ? name : isDefault ? DEFAULT_PAGE_NAME : '',
        order: isPageOrder(order) ? order : DEFAULT_PAGE_ORDER,
      }),
    );
  }
  if (pages.length === 0) pages.push(DEFAULT_PAGE);
  return new Map(pages.sort(comparePages).map((page) => [page.id, page]));
}

/**
 * The first page of a page map in page order (as `readPages` inserts them).
 *
 * @param pages - The live pages, in page order.
 * @returns The first page's id; the default page's for an empty map.
 */
export function firstPageIn(pages: ReadonlyMap<PageId, Page>): PageId {
  for (const id of pages.keys()) return id;
  return DEFAULT_PAGE_ID;
}
