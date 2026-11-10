import { DEFAULT_PAGE_ID, isPageIdText } from '@canvas/schema';

import { isSamePlainValue } from './plain-value.js';

// A root object's page is in its `placement` group from layout 4. A
// placement stored before has no `pageId`: it reads `page-1` for a root object and `null` for a
// child, and so does a root object whose stored `pageId` is `null` or not an id. A child whose
// stored `pageId` is not `null` (only a hostile writer stores one: commands write placement
// whole) is read on its root ancestor's page, `null` (R6). Nothing stored is rewritten: the
// first command that places such an object writes `pageId`, since placement is written whole.

/** The placement field that holds a root object's page. */
export const PAGE_FIELD = 'pageId';

/**
 * Sets a decoded object's `pageId` from its stored placement by the read fallback above.
 * Leaves an object whose `parentId` is neither `null` nor a string as it is, for the kind check
 * to report.
 *
 * @param target - The object being built, its placement fields read.
 */
export function readPlacementPage(target: Record<string, unknown>): void {
  const { parentId } = target;
  if (parentId === null) {
    target[PAGE_FIELD] = isPageIdText(target[PAGE_FIELD]) ? target[PAGE_FIELD] : DEFAULT_PAGE_ID;
  } else if (typeof parentId === 'string') {
    target[PAGE_FIELD] = null;
  }
}

/**
 * Tells whether a placement about to be written equals the stored one as the reader reads it, so
 * an unchanged object on a board stored before layout 4 is not rewritten only to add the
 * `pageId` the fallback gives it.
 *
 * @param stored - The stored placement value.
 * @param written - The placement to write, `pageId` included.
 * @returns True when writing it changes nothing a reader sees.
 */
export function isSamePlacement(
  stored: unknown,
  written: Readonly<Record<string, unknown>>,
): boolean {
  if (isSamePlainValue(stored, written)) return true;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return false;
  if (PAGE_FIELD in stored) return false;
  const read: Record<string, unknown> = { ...(stored as Readonly<Record<string, unknown>>) };
  readPlacementPage(read);
  return isSamePlainValue(read, written);
}
