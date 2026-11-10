import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import { lockedDescendantOf, pagesOf, type NamedObject } from '../command-checks.js';
import { commandError, type CommandError } from '../command-error.js';
import type { BoardReader } from '../command.js';

import { shownRootPage } from './page-support.js';

// What `moveObjectsToPage` moves: the listed objects not already on
// the target page, their subtrees, the connectors whose targets all move, and the comments pinned
// to anything that moves.

/**
 * An object's root ancestor. Cycle-safe.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The root ancestor (the object itself at the root), or `undefined` when the chain of
 *   parents breaks or loops.
 */
export function rootOf(
  board: Pick<BoardReader, 'get'>,
  object: BoardObject,
): BoardObject | undefined {
  let current = object;
  const walked = new Set<ObjectId>();
  while (current.parentId !== null) {
    if (walked.has(current.id)) return undefined;
    walked.add(current.id);
    const parent = board.get(current.parentId);
    if (parent === undefined) return undefined;
    current = parent;
  }
  return current;
}

/**
 * The refusals of moving locked objects (as a move refuses them): a locked object, or a group
 * holding one.
 *
 * @param board - The board before the command.
 * @param named - The listed objects.
 * @returns The errors.
 */
export function lockErrors(
  board: BoardReader,
  named: readonly NamedObject<ObjectId>[],
): CommandError[] {
  const errors: CommandError[] = [];
  for (const { object, path } of named) {
    if (object.locked) {
      errors.push(commandError('locked', object.id, path, `"${object.id}" is locked`));
      continue;
    }
    const locked = object.type === 'group' ? lockedDescendantOf(board, object) : undefined;
    if (locked !== undefined) {
      const message = `"${object.id}" holds the locked object "${locked}"`;
      errors.push(commandError('locked', object.id, path, message));
    }
  }
  return errors;
}

/**
 * Adds an object's subtree to a set, through the reverse index of children.
 *
 * @param board - The board.
 * @param id - The object.
 * @param into - The set.
 */
function addSubtree(board: BoardReader, id: ObjectId, into: Set<ObjectId>): void {
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (into.has(next)) continue;
    into.add(next);
    pending.push(...board.references.childrenOf(next));
  }
}

/**
 * Whether a connector's attached ends all land on moving objects (it has at least one).
 *
 * @param object - The connector.
 * @param moving - The moving objects.
 * @returns True when it moves with them.
 */
function isCarried(object: BoardObject, moving: ReadonlySet<ObjectId>): boolean {
  if (object.type !== 'connector') return false;
  const ends = [object.from, object.to].flatMap((end) => (end.kind === 'object' ? [end] : []));
  return ends.length > 0 && ends.every((end) => moving.has(end.objectId));
}

/**
 * The objects a page move places on the target page (`tops`) and every object that changes page
 * with them (`moving`: their subtrees too). Cost: the moved subtrees and their connectors and
 * comments.
 *
 * @param board - The board before the command.
 * @param listed - The listed objects not under another listed object.
 * @param pageId - The target page.
 * @returns The tops and the moving set.
 */
export function movingSet(
  board: BoardReader,
  listed: readonly BoardObject[],
  pageId: PageId,
): { readonly tops: BoardObject[]; readonly moving: Set<ObjectId> } {
  const pages = pagesOf(board);
  const isElsewhere = (object: BoardObject): boolean => {
    const root = rootOf(board, object);
    return root !== undefined && shownRootPage(pages, root) !== pageId;
  };
  const tops = listed.filter(isElsewhere);
  const moving = new Set<ObjectId>();
  for (const { id } of tops) addSubtree(board, id, moving);
  const pending = [...moving];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const referrers = [
      ...board.references.connectorsAttachedTo(id),
      ...board.references.commentsAnchoredTo(id),
    ];
    for (const referrerId of referrers) {
      const referrer = board.get(referrerId);
      if (referrer === undefined || moving.has(referrerId) || !isElsewhere(referrer)) continue;
      if (referrer.type === 'connector' && !isCarried(referrer, moving)) continue;
      tops.push(referrer);
      moving.add(referrerId);
      pending.push(referrerId);
    }
  }
  return { tops, moving };
}
