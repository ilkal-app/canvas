// A board change set as one page sees it: what came onto the page is created,
// what left it deleted, what stayed on it updated. Pure. Objects a sliced page switch still owes
// were never announced: a change to one announces it, or drops it when it left.
import type { ChangeSet } from '@canvas/document';
import type { ObjectId, PageId } from '@canvas/schema';

import type { PageMove } from './page-index.js';

/**
 * The part of a board change set the page shown sees, or none when it sees nothing.
 *
 * @param changes - The board's change set.
 * @param moves - The objects it moved between pages, with their pages before and after.
 * @param page - The page shown.
 * @param pageOf - An object's page now.
 * @param owed - Objects a sliced switch has not announced yet; those this change touches are
 *   taken out of it.
 * @returns The page's change set, its ids sorted; `undefined` when it touches nothing there.
 */
export function pageChangeOf(
  changes: ChangeSet,
  moves: ReadonlyMap<ObjectId, PageMove>,
  page: PageId,
  pageOf: (id: ObjectId) => PageId | undefined,
  owed: Set<ObjectId> | undefined,
): ChangeSet | undefined {
  const created: ObjectId[] = [];
  const updated: ObjectId[] = [];
  const deleted: ObjectId[] = [];
  const ids = new Set([
    ...changes.created,
    ...changes.updated,
    ...changes.deleted,
    ...moves.keys(),
  ]);
  for (const id of ids) {
    const now = pageOf(id);
    const { before, after } = moves.get(id) ?? { before: now, after: now };
    const was = before === page;
    const is = after === page;
    if (owed?.delete(id) === true) {
      if (is) created.push(id);
    } else if (was && is) updated.push(id);
    else if (is) created.push(id);
    else if (was) deleted.push(id);
  }
  if (created.length + updated.length + deleted.length === 0 && changes.pages === undefined) {
    return undefined;
  }
  return {
    origin: changes.origin,
    isLocal: changes.isLocal,
    created: created.sort(),
    updated: updated.sort(),
    deleted: deleted.sort(),
    ...(changes.pages === undefined ? {} : { pages: changes.pages }),
  };
}
