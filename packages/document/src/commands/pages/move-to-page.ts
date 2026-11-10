import { z } from 'zod';

import {
  applyTransform,
  detachAcrossPages,
  objectIdSchema,
  pageIdSchema,
  parentToBoardTransform,
  type Board,
  type BoardObject,
  type ConnectorDeletePolicy,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

import { checkObject, hasListedAncestor, lookUpNamed, pagesOf } from '../command-checks.js';
import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type BoardReader, type Command } from '../command.js';
import { normalizeAngle } from '../normalize-angle.js';
import { comparePaintOrder } from '../paint-order.js';
import { SubBoard } from '../sub-board.js';
import { unlessParentCycle } from '../world-frame.js';
import { zKeysOnTop } from '../z-placement.js';

import { lockErrors, movingSet, rootOf } from './move-to-page-set.js';
import { livePage, shownRootPage } from './page-support.js';

/** Validates the input of {@link moveObjectsToPageCommand}. */
export const moveObjectsToPageInputSchema = z
  .strictObject({
    /** The objects to move; an object under another listed object moves with it. */
    ids: z.array(objectIdSchema).min(1).describe('The objects to move to the page.'),
    /** The page to move them to. */
    pageId: pageIdSchema.describe('The page to move them to.'),
    /** What happens to a connector left behind attached to a moved object. */
    connectorPolicy: z
      .enum(['detach', 'delete'] satisfies ConnectorDeletePolicy[])
      .default('detach')
      .describe(
        'A connector left behind attached to a moved object: detach its end (default) or delete it.',
      ),
  })
  .describe('Moves objects to another page, keeping where they are on the board.');

/** What {@link moveObjectsToPageCommand} returns. */
export interface MoveObjectsToPageResult {
  /** The objects placed on the page (their subtrees go with them), sorted. */
  readonly movedIds: readonly ObjectId[];
  /** The connectors and comments whose references were detached, sorted. */
  readonly detachedIds: readonly ObjectId[];
  /** The connectors deleted under the `delete` policy, sorted. */
  readonly deletedIds: readonly ObjectId[];
}

/** What {@link moveObjectsToPageCommand} will write. */
export interface MoveObjectsToPagePlan extends MoveObjectsToPageResult {
  /** Every object written, whole and validated. */
  readonly written: readonly BoardObject[];
}

/** The plan of a move that changes nothing (every object already on the page). */
const NOTHING: MoveObjectsToPagePlan = Object.freeze({
  movedIds: [],
  detachedIds: [],
  deletedIds: [],
  written: [],
});

/**
 * Lifts an object to the board root with its world transform composed (as `reparent` does), on
 * the target page.
 *
 * @param board - A board holding its chain of ancestors.
 * @param object - The object.
 * @param pageId - The target page.
 * @param z - Its new key.
 * @returns The object as placed.
 */
function lifted(board: Board, object: BoardObject, pageId: PageId, z: string): BoardObject {
  const position = applyTransform(parentToBoardTransform(board, object), object);
  let rotation = object.rotation;
  const walked = new Set<ObjectId>([object.id]);
  for (
    let parent = object.parentId === null ? undefined : board.objects.get(object.parentId);
    parent !== undefined && !walked.has(parent.id);
    parent = parent.parentId === null ? undefined : board.objects.get(parent.parentId)
  ) {
    walked.add(parent.id);
    rotation += parent.rotation;
  }
  const isLifted = object.parentId !== null;
  return {
    ...object,
    parentId: null,
    pageId,
    x: position.x,
    y: position.y,
    rotation: isLifted ? normalizeAngle(rotation) : object.rotation,
    z,
  };
}

/**
 * Whether the moved objects can keep their keys: all are root objects already, and every key is
 * above the target page's root objects (an empty page has none). They are then on top of that
 * page in their previous order without a write of `z`, so a concurrent drag, which writes the
 * placement, keeps one client's object whole. Otherwise they get fresh keys on top.
 *
 * @param board - The board before the command.
 * @param tops - The objects placed on the page.
 * @param pageId - The target page.
 * @returns True to keep their keys.
 */
function keepsKeys(board: BoardReader, tops: readonly BoardObject[], pageId: PageId): boolean {
  if (tops.some(({ parentId }) => parentId !== null)) return false;
  const lowest = tops.reduce((low, { z }) => (z < low ? z : low), tops[0]?.z ?? '');
  const pages = pagesOf(board);
  for (const id of board.references.childrenOf(null)) {
    const object = board.get(id);
    if (object === undefined || shownRootPage(pages, object) !== pageId) continue;
    if (object.z >= lowest) return false;
  }
  return true;
}

/**
 * Plans the placements, then the references across pages the move leaves (see the command).
 *
 * @param board - The board before the command.
 * @param tops - The objects placed on the page, bottom first in paint order.
 * @param moving - Every object that changes page.
 * @param input - The parsed input.
 * @param errors - Where to add refusals.
 * @returns The plan, or `undefined` when refused.
 */
function planMove(
  board: BoardReader,
  tops: readonly BoardObject[],
  moving: ReadonlySet<ObjectId>,
  input: z.output<typeof moveObjectsToPageInputSchema>,
  errors: CommandError[],
): MoveObjectsToPagePlan | undefined {
  const [first, ...rest] = tops.map(({ id }) => id);
  if (first === undefined) return NOTHING;
  const keys = keepsKeys(board, tops, input.pageId)
    ? tops.map(({ z }) => z)
    : zKeysOnTop(board, null, [first, ...rest], ['ids'], errors);
  if (keys === undefined) return undefined;
  const frames = new SubBoard(board);
  for (const { id } of tops) frames.addWithAncestors(id);
  const framed = frames.toBoard();
  const placed = tops.map((object, index) =>
    lifted(framed, object, input.pageId, keys[index] ?? object.z),
  );
  const overlay = new Map(placed.map((object) => [object.id, object]));
  const reader: BoardReader = {
    get: (id) => overlay.get(id) ?? board.get(id),
    references: board.references,
  };
  const candidates = new Set<ObjectId>();
  for (const id of moving) {
    candidates.add(id);
    for (const other of board.references.connectorsAttachedTo(id)) candidates.add(other);
    for (const other of board.references.commentsAnchoredTo(id)) candidates.add(other);
  }
  const pages = pagesOf(board);
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
    return root === undefined ? undefined : shownRootPage(pages, root);
  };
  const detached = unlessParentCycle(() =>
    detachAcrossPages(subBoard.toBoard(), candidates, pageOf),
  );
  if (detached === null) {
    errors.push(
      commandError('parent-cycle', null, ['ids'], 'a parent cycle hides where an end is'),
    );
    return undefined;
  }
  const deleted = detached
    .filter(({ id }) => input.connectorPolicy === 'delete' && !moving.has(id))
    .filter(({ type }) => type === 'connector')
    .map(({ id }) => id);
  const written = new Map(placed.map((object) => [object.id, object]));
  for (const object of detached) if (!deleted.includes(object.id)) written.set(object.id, object);
  const checked = [...written.values()].flatMap(
    (object) => checkObject(board, object, errors) ?? [],
  );
  if (errors.length > 0) return undefined;
  return {
    movedIds: tops.map(({ id }) => id).sort(),
    detachedIds: detached
      .map(({ id }) => id)
      .filter((id) => !deleted.includes(id))
      .sort(),
    deletedIds: deleted.sort(),
    written: checked,
  };
}

/**
 * `moveObjectsToPage`: moves objects to another page. Each listed
 * object not under another listed object is placed on the board root of the target page, its
 * placement written whole (`parentId: null`, the page, its board position and rotation kept: a
 * child of a group or frame is lifted out, its world transform composed as `reparent` does), on
 * top of the root objects in its previous paint order, with fresh keys (root objects whose keys
 * are already above the target page's keep them, so nothing but the placement is written); its
 * subtree goes with it. A connector whose targets all move moves with them; a comment pinned to a moved object
 * moves with it. A connector left behind attached to a moved object has that end detached to a
 * free point where it was, or under the `delete` policy is deleted; a moved connector's
 * ends and a moved comment's pin on objects left behind are detached. A target equal to an
 * object's page writes nothing for it. Refused for a page that is not live (`missing-page`), a
 * missing object, and a locked object or a group holding one (`locked`, as a move). One undo step.
 */
export const moveObjectsToPageCommand: Command<
  typeof moveObjectsToPageInputSchema,
  MoveObjectsToPagePlan,
  MoveObjectsToPageResult
> = {
  name: 'moveObjectsToPage',
  isPlacePreserving: true,
  description: 'Moves objects to another page, keeping where they are on the board.',
  input: moveObjectsToPageInputSchema,
  validate(context, input) {
    const { board } = context;
    const errors: CommandError[] = [];
    livePage(board, input.pageId, ['pageId'], errors);
    const looked = lookUpNamed(
      board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    errors.push(...looked.errors, ...lockErrors(board, looked.named));
    if (errors.length > 0) return reject(errors);
    const ids = new Set(input.ids);
    const listed = looked.named
      .map(({ object }) => object)
      .filter((object) => !hasListedAncestor(board, object, ids));
    const { tops, moving } = movingSet(board, listed, input.pageId);
    const frames = new SubBoard(board);
    for (const { id } of tops) frames.addWithAncestors(id);
    const framed = frames.toBoard();
    const ordered = [...tops].sort((first, second) => comparePaintOrder(framed, first, second));
    const plan = planMove(board, ordered, moving, input, errors);
    return plan === undefined ? reject(errors) : accept(plan);
  },
  apply(transaction, input, plan) {
    for (const id of plan.deletedIds) transaction.deleteObject(id);
    for (const object of plan.written) transaction.setObject(object);
    return { movedIds: plan.movedIds, detachedIds: plan.detachedIds, deletedIds: plan.deletedIds };
  },
};
