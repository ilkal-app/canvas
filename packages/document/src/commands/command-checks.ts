import {
  DEFAULT_PAGE,
  firstPageIdOf,
  validateBoard,
  type BoardIssue,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

import { validateObject } from '../store/object-validation.js';
import { withPlacedPage } from '../store/placed-page.js';

import {
  commandError,
  errorsFromIssues,
  isCommandErrorCode,
  type CommandError,
  type CommandErrorCode,
} from './command-error.js';
import type { BoardReader } from './command.js';
import { SubBoard } from './sub-board.js';

/** An object a command names, with where its id sits in the input. */
export interface NamedObject<Entry> {
  /** The object as it is on the board. */
  readonly object: BoardObject;
  /** The input entry naming it. */
  readonly entry: Entry;
  /** The path of that entry in the input. */
  readonly path: readonly (string | number)[];
}

/**
 * Looks up the objects a command names, reporting ids listed twice and ids with no readable
 * object.
 *
 * @param board - The board before the command.
 * @param entries - The input entries.
 * @param idOf - The object id an entry names.
 * @param pathOf - The input path of the entry at an index.
 * @returns The objects in input order, and the errors.
 */
export function lookUpNamed<Entry>(
  board: BoardReader,
  entries: readonly Entry[],
  idOf: (entry: Entry) => ObjectId,
  pathOf: (index: number) => readonly (string | number)[],
): { readonly named: NamedObject<Entry>[]; readonly errors: CommandError[] } {
  const named: NamedObject<Entry>[] = [];
  const errors: CommandError[] = [];
  const seen = new Set<ObjectId>();
  entries.forEach((entry, index) => {
    const id = idOf(entry);
    const path = pathOf(index);
    if (seen.has(id)) {
      errors.push(commandError('duplicate-id', id, path, `"${id}" is listed more than once`));
      return;
    }
    seen.add(id);
    const object = board.get(id);
    if (object === undefined) {
      errors.push(commandError('missing-object', id, path, `there is no object "${id}"`));
      return;
    }
    named.push({ object, entry, path });
  });
  return { named, errors };
}

/**
 * Validates an object the command would write, as the store's write will (`validateObject`,
 *): a new object whole; a write to one on the board field by field, judging only the
 * fields it changes and the cross-field rules they take part in, so a field a peer left invalid
 * does not refuse the command unless the command writes it; and nothing it stores may be a value
 * the relay's door refuses.
 *
 * @param board - The board before the command, to read the object as stored from.
 * @param candidate - The object as the command would leave it.
 * @param errors - Where to add the problems.
 * @returns The object to write, or `undefined` when it is invalid.
 */
export function checkObject(
  board: BoardReader,
  candidate: unknown,
  errors: CommandError[],
): BoardObject | undefined {
  const id =
    typeof candidate === 'object' && candidate !== null && 'id' in candidate
      ? candidate.id
      : undefined;
  const stored = typeof id === 'string' ? board.get(id as ObjectId) : undefined;
  const validation = validateObject(candidate, stored);
  if (validation.isValid) return validation.object;
  errors.push(...errorsFromIssues('invalid-object', validation.objectId, validation.issues));
  return undefined;
}

/**
 * Proposed objects with their pages settled as the store will settle them on write
 * (`store/placed-page.ts`): a root object given no page is on the page it is on now, or a new one
 * on the first page; an object in a group or frame names none.
 *
 * @param board - The board before the command.
 * @param proposed - The objects as the command would write them.
 * @returns The objects, each with its `pageId`.
 */
export function settledPages(board: BoardReader, proposed: readonly BoardObject[]): BoardObject[] {
  const view = {
    get: (id: ObjectId) => board.get(id),
    before: (id: ObjectId) => board.get(id),
    firstPageId: () =>
      board.defaultPageId?.() ?? firstPageIdOf({ objects: new Map(), pages: pagesOf(board) }),
  };
  return proposed.map((object) => withPlacedPage(object, board.get(object.id), view));
}

/**
 * The board's live pages, as a command reads them.
 *
 * @param board - The board.
 * @returns The pages, in page order; the default page alone for a reader without pages.
 */
export function pagesOf(board: BoardReader): ReadonlyMap<PageId, Page> {
  return board.readPages?.() ?? new Map([[DEFAULT_PAGE.id, DEFAULT_PAGE]]);
}

/**
 * Checks the references new or changed objects make (parent, connector ends, comment anchor)
 * with the schema's `validateBoard`, run on just the objects involved:
 * the proposed objects laid over the board, their chains of ancestors, and the objects their
 * connector ends and anchors name.
 *
 * @param board - The board before the command.
 * @param proposed - The objects as the command would write them.
 * @returns The reference problems of the proposed objects.
 */
export function referenceErrors(
  board: BoardReader,
  proposed: readonly BoardObject[],
): CommandError[] {
  const settled = settledPages(board, proposed);
  const subBoard = new SubBoard(board, settled);
  for (const object of settled) {
    subBoard.addWithAncestors(object.id);
    if (object.type === 'instance') subBoard.addInstanceDefinitions(object.id);
    // The targets' ancestors too: a target's page is its root ancestor's.
    if (object.type === 'connector') {
      for (const end of [object.from, object.to]) {
        if (end.kind === 'object') subBoard.addWithAncestors(end.objectId);
      }
    }
    if (object.type === 'comment' && object.anchor.kind === 'object') {
      subBoard.addWithAncestors(object.anchor.objectId);
    }
  }
  const proposedIds = new Set<string>(proposed.map((object) => object.id));
  return validateBoard(subBoard.toBoard())
    .filter(
      (issue): issue is BoardIssue & { readonly code: CommandErrorCode } =>
        issue.objectId !== null &&
        proposedIds.has(issue.objectId) &&
        isCommandErrorCode(issue.code),
    )
    .map((issue) => commandError(issue.code, issue.objectId, issue.path, issue.message));
}

/**
 * The first locked object under a group, found through the reverse index of children. A group
 * carries its children when it moves, turns or is resized, so a locked child locks the group's
 * transform. A parent cycle ends the walk.
 *
 * @param board - The board.
 * @param group - The group.
 * @returns The id of a locked descendant, or `undefined` when there is none.
 */
export function lockedDescendantOf(board: BoardReader, group: BoardObject): ObjectId | undefined {
  const seen = new Set<ObjectId>([group.id]);
  const pending = [...board.references.childrenOf(group.id)];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const object = board.get(next);
    if (object?.locked === true) return next;
    pending.push(...board.references.childrenOf(next));
  }
  return undefined;
}

/**
 * Checks that an object may be moved or resized: it is not locked, nor
 * is a group holding a locked object, and none of its ancestors is listed too, which would move
 * it twice.
 *
 * @param board - The board before the command.
 * @param object - The object.
 * @param path - The input path of the entry naming it.
 * @param ids - Every object the command names.
 * @returns The problems found.
 */
export function movabilityErrors(
  board: BoardReader,
  object: BoardObject,
  path: readonly (string | number)[],
  ids: ReadonlySet<ObjectId>,
): CommandError[] {
  const errors: CommandError[] = [];
  if (object.locked)
    errors.push(commandError('locked', object.id, path, `"${object.id}" is locked`));
  const locked = object.type === 'group' ? lockedDescendantOf(board, object) : undefined;
  if (locked !== undefined) {
    const message = `"${object.id}" holds the locked object "${locked}"`;
    errors.push(commandError('locked', object.id, path, message));
  }
  if (hasListedAncestor(board, object, ids)) {
    const message = `"${object.id}" is listed together with one of its ancestors`;
    errors.push(commandError('overlapping-selection', object.id, path, message));
  }
  return errors;
}

/**
 * Tells whether any ancestor of an object is among the given ids: moving both would move the
 * object twice, since its position is relative to its parent; copying both would copy it twice.
 * A parent cycle ends the walk.
 *
 * @param board - The board, read one object at a time.
 * @param object - The object.
 * @param ids - The other objects named (a command's input, a selection).
 * @returns `true` when an ancestor is listed.
 */
export function hasListedAncestor(
  board: Pick<BoardReader, 'get'>,
  object: BoardObject,
  ids: ReadonlySet<ObjectId>,
): boolean {
  const walked = new Set<ObjectId>([object.id]);
  let parentId = object.parentId;
  while (parentId !== null && !walked.has(parentId)) {
    if (ids.has(parentId)) return true;
    walked.add(parentId);
    parentId = board.get(parentId)?.parentId ?? null;
  }
  return false;
}
