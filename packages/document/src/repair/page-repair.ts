import {
  compareSiblings,
  detachAcrossPages,
  isValidKey,
  MAX_KEY_LENGTH,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { rootOf } from '../commands/pages/move-to-page-set.js';
import { shownRootPage } from '../commands/pages/page-support.js';
import { SubBoard } from '../commands/sub-board.js';
import { unlessParentCycle } from '../commands/world-frame.js';
import { firstPageIn } from '../pages/page-map.js';
import { generateObjectKeys } from '../z-order/object-keys.js';

import type { RepairView } from './reference-repair.js';

// The page rules of the reference repair, planned after the rules of
// `reference-repair.ts` on the board as they leave it, in the same pass and transaction:
// - R1: a root object on a page that is not live (deleted concurrently, or `page-1` read by
//   fallback after Page 1 was deleted) is kept: its placement is rewritten whole onto the first
//   page, the same position and rotation, on top of the root objects in its previous relative
//   order (`z`, then id), with fresh keys;
// - R3: a connector end attached to an object on another page becomes a free point where it was,
//   measured on the board as it is (a page move keeps board positions); never a delete;
// - R4: a comment anchored to an object on another page becomes a point pin where it was.
// R2 (an orphan landing on the root takes its removed root ancestor's page) is in `reroot`; R5
// (page order) and R6 (a child naming a page) need no write. Pure plan from reads, so every
// client writes the same values, and a second run plans nothing.

/** What the page rules read: the board after the reference rules, its indexes and its pages. */
export interface PageRepairInput {
  /** The board as the reference rules leave it (its objects; the page rules ask nothing else). */
  readonly view: Pick<RepairView, 'get'>;
  /** The board's reverse indexes, as of the last completed transaction. */
  readonly references: BoardReader['references'];
  /** The live pages, in page order; never empty. */
  readonly pages: ReadonlyMap<PageId, Page>;
  /** The objects the change created, changed or removed, and those the reference rules wrote. */
  readonly touched: Iterable<ObjectId>;
  /** Whether the change changed the pages: every root object is then a candidate for R1. */
  readonly isPagesChanged: boolean;
}

/**
 * The top key among the root's children now, and among objects about to land on the root.
 *
 * @param input - The repair's input.
 * @param landing - Objects the reference rules put on the root.
 * @returns The highest key, or `null`.
 */
function rootTopKey(input: PageRepairInput, landing: readonly BoardObject[]): string | null {
  const topId = input.references.topChildOf(null);
  let top = topId === undefined ? null : (input.view.get(topId)?.z ?? null);
  for (const { parentId, z } of landing) {
    if (parentId === null && (top === null || z > top)) top = z;
  }
  return top;
}

/**
 * R1: the root objects on a page that is not live, moved onto the first page on top of the root.
 *
 * @param input - The repair's input.
 * @param planned - The objects the reference rules wrote, which keep their keys.
 * @returns The moved objects, bottom first.
 */
function planOrphanedPages(
  input: PageRepairInput,
  planned: ReadonlyMap<ObjectId, BoardObject>,
): BoardObject[] {
  const first = firstPageIn(input.pages);
  const candidates = new Set(input.touched);
  if (input.isPagesChanged) for (const id of input.references.childrenOf(null)) candidates.add(id);
  const stranded: BoardObject[] = [];
  const relabelled: BoardObject[] = [];
  for (const id of candidates) {
    const object = input.view.get(id);
    if (object?.parentId !== null || object.pageId === undefined) continue;
    if (object.pageId !== null && input.pages.has(object.pageId)) continue;
    // A root object the reference rules just placed keeps its fresh key; only its page changes.
    if (planned.has(id)) relabelled.push({ ...object, pageId: first });
    else stranded.push(object);
  }
  const ids = stranded.sort(compareSiblings).map(({ id }) => id);
  const top = rootTopKey(input, [...planned.values()]);
  const keys = top !== null && !isValidKey(top) ? undefined : generateObjectKeys(top, null, ids);
  const moved = stranded.map((object, index) => {
    const z = keys?.[index];
    const keyed = z !== undefined && z.length <= MAX_KEY_LENGTH ? { z } : {};
    return { ...object, ...keyed, pageId: first };
  });
  return [...relabelled, ...moved];
}

/**
 * The connectors and comments whose references may cross pages after a change: those among, or
 * attached to, or pinned on, the subtrees of the touched objects.
 *
 * @param input - The repair's input.
 * @param roots - The objects whose subtrees to search.
 * @returns The candidates.
 */
function referrersOf(input: PageRepairInput, roots: Iterable<ObjectId>): Set<ObjectId> {
  const referrers = new Set<ObjectId>();
  const walked = new Set<ObjectId>();
  const pending = [...roots];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (walked.has(id) || input.view.get(id) === undefined) continue;
    walked.add(id);
    referrers.add(id);
    for (const other of input.references.connectorsAttachedTo(id)) referrers.add(other);
    for (const other of input.references.commentsAnchoredTo(id)) referrers.add(other);
    pending.push(...input.references.childrenOf(id));
  }
  return referrers;
}

/**
 * Plans the page rules (see above) on the board the reference rules leave.
 *
 * @param input - The board, its indexes and pages, and what changed.
 * @param planned - The objects the reference rules will write, by id, as they write them.
 * @returns The objects to write, after the reference rules' writes; empty when nothing crosses.
 */
export function planPageRepair(
  input: PageRepairInput,
  planned: ReadonlyMap<ObjectId, BoardObject>,
): BoardObject[] {
  const moved = planOrphanedPages(input, planned);
  const overlay = new Map([...planned, ...moved.map((object) => [object.id, object] as const)]);
  const reader: BoardReader = {
    get: (id) => overlay.get(id) ?? input.view.get(id),
    references: input.references,
  };
  const candidates = referrersOf(input, [...input.touched, ...overlay.keys()]);
  const subBoard = new SubBoard(reader);
  for (const id of candidates) {
    subBoard.addWithAncestors(id);
    subBoard.addConnectorTargets(subBoard.lookUp(id));
    const object = subBoard.lookUp(id);
    if (object?.type === 'comment' && object.anchor.kind === 'object') {
      subBoard.addWithAncestors(object.anchor.objectId);
    }
  }
  const pageOf = (object: BoardObject): PageId | undefined => {
    const root = rootOf(reader, object);
    return root === undefined ? undefined : shownRootPage(input.pages, root);
  };
  const detached =
    unlessParentCycle(() => detachAcrossPages(subBoard.toBoard(), candidates, pageOf)) ?? [];
  const written = new Map(moved.map((object) => [object.id, object]));
  for (const object of detached) written.set(object.id, object);
  return [...written.values()];
}
