import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

// Every write of an object settles its page, so placement is always
// written whole with the right `pageId`: an object in a group or frame names no page (`null`); a
// root object keeps the page it is given; a root object given none (a caller that does not know
// pages, or a child lifted out of its group by `ungroup`, `reparent` or the repair) is on the page
// it was on, its own as a root object or its root ancestor's as a child, and a new one on the
// board's first page.

/** What settling a page reads, as of now in the transaction. */
export interface PagePlacementView {
  /**
   * An object as it is now.
   *
   * @param id - The object id.
   * @returns The object, or `undefined`.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * An object as it was before the transaction, for an ancestor the transaction already removed
   * (`ungroup` deletes the group it lifts the children out of).
   *
   * @param id - The object id.
   * @returns The object, or `undefined`.
   */
  before(id: ObjectId): BoardObject | undefined;
  /**
   * The board's first live page.
   *
   * @returns Its id.
   */
  firstPageId(): PageId;
}

/**
 * The page an object is on as stored now: a root object's own, a child's root ancestor's.
 * Cycle-safe.
 *
 * @param object - The object.
 * @param view - The board now.
 * @returns The page, or `undefined` when the chain of parents breaks or loops.
 */
function currentPageOf(object: BoardObject, view: PagePlacementView): PageId | undefined {
  let current: BoardObject | undefined = object;
  const walked = new Set<ObjectId>();
  while (current !== undefined && current.parentId !== null) {
    if (walked.has(current.id)) return undefined;
    walked.add(current.id);
    current = view.get(current.parentId) ?? view.before(current.parentId);
  }
  return current?.pageId ?? undefined;
}

/**
 * An object to write with its page settled (see above).
 *
 * @param object - The object as the caller gives it.
 * @param existing - The object as stored, if readable.
 * @param view - The board now.
 * @returns The object, or a copy with its `pageId` set.
 */
export function withPlacedPage(
  object: BoardObject,
  existing: BoardObject | undefined,
  view: PagePlacementView,
): BoardObject {
  if (object.parentId !== null)
    return object.pageId === null ? object : { ...object, pageId: null };
  if (typeof object.pageId === 'string') return object;
  const pageId =
    (existing === undefined ? undefined : currentPageOf(existing, view)) ?? view.firstPageId();
  return { ...object, pageId };
}
