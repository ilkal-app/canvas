import type * as Y from 'yjs';

import {
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_NAME,
  DEFAULT_PAGE_ORDER,
  pageSchema,
  type Page,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { isSamePlainValue } from '../codec/plain-value.js';
import { DocumentWriteError } from '../store/document-write-error.js';

import {
  DEFAULT_PAGE_IDENTITY,
  hasStoredPages,
  isPageIdentity,
  pageKey,
  PAGE_FIELDS,
  type PageIdentity,
} from './page-map.js';

// The writes of the page commands into the pages map, inside one transaction.
// Every write first materialises the virtual default page when the board stores no page, with
// the identity every client writes alike and never a default name or order, so two clients
// materialising it at once converge and a concurrent rename of it is kept.

/** Who creates a page, and when: what its `.identity` key records. */
export interface PageCreation {
  /** The principal of the command. */
  readonly createdBy: PrincipalId;
  /** The command's time, ms since the epoch. */
  readonly createdAt: number;
}

/**
 * Validates a page about to be written.
 *
 * @param page - The page.
 * @returns The parsed page.
 * @throws {DocumentWriteError} When it fails `pageSchema`.
 */
function parsePage(page: Page): Page {
  const parsed = pageSchema.safeParse(page);
  if (!parsed.success) throw new DocumentWriteError(String(page.id), parsed.error.issues);
  return parsed.data;
}

/**
 * Writes the default page's identity when the board stores no page yet.
 *
 * @param map - The pages map.
 */
function materialise(map: Y.Map<unknown>): void {
  if (!hasStoredPages(map)) map.set(pageKey(DEFAULT_PAGE_ID, 'identity'), DEFAULT_PAGE_IDENTITY);
}

/**
 * Writes a page field unless it already reads the same: for the default page an absent value
 * reads as its default, so writing the default writes nothing.
 *
 * @param map - The pages map.
 * @param pageId - The page.
 * @param field - `name` or `order`.
 * @param value - The value.
 */
function writeField(
  map: Y.Map<unknown>,
  pageId: PageId,
  field: 'name' | 'order',
  value: string,
): void {
  const key = pageKey(pageId, field);
  if (map.has(key)) {
    if (!isSamePlainValue(map.get(key), value)) map.set(key, value);
    return;
  }
  const fallback = field === 'name' ? DEFAULT_PAGE_NAME : DEFAULT_PAGE_ORDER;
  if (pageId === DEFAULT_PAGE_ID && value === fallback) return;
  map.set(key, value);
}

/**
 * Writes a page: creates it, its three keys, when it is not stored (the
 * default page: its shared identity only, then what differs from its defaults); else writes its
 * name and order where they differ. Materialises the virtual default page first.
 *
 * @param map - The pages map, inside a transaction.
 * @param page - The page as it should read.
 * @param creation - Who creates it, for a new page's identity.
 * @throws {DocumentWriteError} When the page fails `pageSchema`.
 */
export function writePage(map: Y.Map<unknown>, page: Page, creation: PageCreation): void {
  const parsed = parsePage(page);
  materialise(map);
  const identityKey = pageKey(parsed.id, 'identity');
  if (!isPageIdentity(map.get(identityKey), parsed.id)) {
    const identity: PageIdentity =
      parsed.id === DEFAULT_PAGE_ID
        ? DEFAULT_PAGE_IDENTITY
        : { id: parsed.id, createdBy: creation.createdBy, createdAt: creation.createdAt };
    map.set(identityKey, { ...identity });
  }
  writeField(map, parsed.id, 'name', parsed.name);
  writeField(map, parsed.id, 'order', parsed.order);
}

/**
 * Deletes a page's keys (`deletePage`): its identity, name and order.
 *
 * @param map - The pages map, inside a transaction.
 * @param pageId - The page.
 * @returns True when a key was deleted.
 */
export function erasePage(map: Y.Map<unknown>, pageId: PageId): boolean {
  let isErased = false;
  for (const field of PAGE_FIELDS) {
    const key = pageKey(pageId, field);
    if (!map.has(key)) continue;
    map.delete(key);
    isErased = true;
  }
  return isErased;
}
