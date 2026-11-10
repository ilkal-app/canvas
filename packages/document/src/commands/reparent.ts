import {
  applyTransform,
  finiteCoordinate,
  invertTransform,
  parentToBoardTransform,
  placementTransform,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { ObjectPatch } from '../store/document-store.js';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { normalizeAngle } from './normalize-angle.js';
import { pageOfObject } from './pages/page-support.js';
import { comparePaintOrder } from './paint-order.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame, unlessParentCycle } from './world-frame.js';
import { zKeysOnTop } from './z-placement.js';

// The reparenting step of `moveObjects`: a move that
// ends with an object over another frame, or over the bare board, puts the object there in the
// same command, so the move and the reparent are one transaction and one undo step. The tool
// decides where each object lands (the top-most frame under its centre); this step checks that
// the new parent can take it and keeps the object where it is on the board.

/** One object a move takes into another parent. */
export interface ReparentRequest {
  /** The object, as it is on the board before the command. */
  readonly object: BoardObject;
  /** Its origin after the move, world units in its current parent's frame. */
  readonly position: Point;
  /** The new parent: a frame, or `null` for the board root; never its current parent. */
  readonly parentId: ObjectId | null;
  /** The input path of the move naming it, for errors. */
  readonly path: readonly (string | number)[];
  /**
   * Where its origin goes on the board, when its current parent's frame cannot hold that point
   * (`canHoldPoint`): the move takes it out of that frame, out of a group too, and
   * `position` is not used.
   */
  readonly onBoard?: Point;
}

/** What a reparent writes: the new parent, the placement in its frame and the stacking key. */
export type ReparentPatch = Required<Pick<ObjectPatch, 'parentId' | 'x' | 'y' | 'rotation' | 'z'>>;

/**
 * Looks an object up by a nullable id.
 *
 * @param board - The board.
 * @param id - The id, or `null` for the root.
 * @returns The object, or `undefined` for the root or a missing object.
 */
function lookUp(board: BoardReader, id: ObjectId | null): BoardObject | undefined {
  return id === null ? undefined : board.get(id);
}

/**
 * Why a new parent cannot take an object, if it cannot: an object in a group moves with the
 * group; only a frame (or the root) takes moved objects; an object cannot go inside itself; and
 * a parent the same command moves has no settled frame to convert into.
 *
 * @param board - The board before the command.
 * @param request - The reparent.
 * @param movedIds - Every object the command moves.
 * @returns The refusal, or `undefined` when the parent can take the object.
 */
function targetError(
  board: BoardReader,
  request: ReparentRequest,
  movedIds: ReadonlySet<ObjectId>,
): CommandError | undefined {
  const { object, parentId } = request;
  const path = [...request.path, 'parentId'];
  const refuse = (code: CommandError['code'], message: string) =>
    commandError(code, object.id, path, message);
  const current = lookUp(board, object.parentId);
  if (current?.type === 'group' && request.onBoard === undefined) {
    return refuse('invalid-parent', `"${object.id}" moves with its group "${current.id}"`);
  }
  if (parentId === null) return undefined;
  const target = board.get(parentId);
  if (target === undefined) return refuse('missing-parent', `there is no object "${parentId}"`);
  if (target.type !== 'frame' && target.type !== 'component') {
    const message = `"${parentId}" is a ${target.type}; only a frame or the board root takes it`;
    return refuse('invalid-parent', message);
  }
  const targetPage = pageOfObject(board, target);
  const ownPage = pageOfObject(board, object);
  if (targetPage !== undefined && ownPage !== undefined && targetPage !== ownPage) {
    const message = `"${parentId}" is on page "${targetPage}", and "${object.id}" on page "${ownPage}"`;
    return refuse('cross-page', message);
  }
  const walked = new Set<ObjectId>();
  for (
    let above: BoardObject | undefined = target;
    above !== undefined && !walked.has(above.id);
    above = lookUp(board, above.parentId)
  ) {
    if (above.id === object.id) {
      return refuse('parent-cycle', `"${parentId}" is "${object.id}" or inside it`);
    }
    if (movedIds.has(above.id)) {
      return refuse('overlapping-selection', `"${parentId}" moves in the same command`);
    }
    walked.add(above.id);
  }
  return undefined;
}

/**
 * The chain of parents from `parentId` up to the root, stopping at a parent cycle.
 *
 * @param frames - A board holding the chain.
 * @param parentId - Where to start, or `null` for the root (an empty chain).
 * @returns The parents, nearest first.
 */
function chainFrom(frames: Board, parentId: ObjectId | null): BoardObject[] {
  const chain: BoardObject[] = [];
  const seen = new Set<ObjectId>();
  let next = parentId === null ? undefined : frames.objects.get(parentId);
  while (next !== undefined && !seen.has(next.id)) {
    seen.add(next.id);
    chain.push(next);
    next = next.parentId === null ? undefined : frames.objects.get(next.parentId);
  }
  return chain;
}

/**
 * An object's rotation in a new parent's frame, so it looks the same on the board: its rotation
 * plus its old parents' up to the ancestor both chains share, minus the new parents' up to
 * that ancestor, brought into (−π, π] as `rotateObjects` keeps it. The shared ancestors'
 * rotations never enter the sum, so a move out of a frame into the frame around it is exact.
 *
 * @param frames - A board holding both chains of parents.
 * @param object - The object.
 * @param parentId - The new parent, or `null`.
 * @returns The rotation, radians, in (−π, π].
 */
function rotationIn(frames: Board, object: BoardObject, parentId: ObjectId | null): number {
  const from = chainFrom(frames, object.parentId);
  const to = chainFrom(frames, parentId);
  const toIds = new Set(to.map(({ id }) => id));
  const fromIds = new Set(from.map(({ id }) => id));
  let rotation = object.rotation;
  for (const parent of from) {
    if (toIds.has(parent.id)) break;
    rotation += parent.rotation;
  }
  for (const parent of to) {
    if (fromIds.has(parent.id)) break;
    rotation -= parent.rotation;
  }
  return normalizeAngle(rotation);
}

/**
 * Where an object goes in a new parent's frame so it stays where it is on the board: its origin
 * carried up its old parents to the ancestor both chains share and down the new parents from
 * there, and its rotation as {@link rotationIn} gives it. The shared ancestors' places and turns
 * never enter (a group stored at y = 1e308 swallowed every other term when the origin
 * went through board coordinates, and a turned frame inside it left 8.4e307 in x).
 *
 * @param frames - A board holding both chains of parents.
 * @param object - The object, as it is now.
 * @param parentId - The new parent, or `null` for the root.
 * @returns The placement, or `null` when a chain of parents forms a cycle.
 */
export function placementIn(
  frames: Board,
  object: BoardObject,
  parentId: ObjectId | null,
): Pick<ReparentPatch, 'x' | 'y' | 'rotation'> | null {
  const isAcyclic = unlessParentCycle(() => {
    parentToBoardTransform(frames, object);
    parentToBoardTransform(frames, { ...object, parentId });
    return true;
  });
  if (isAcyclic === null) return null;
  const from = chainFrom(frames, object.parentId);
  const to = chainFrom(frames, parentId);
  const toIds = new Set(to.map(({ id }) => id));
  const fromIds = new Set(from.map(({ id }) => id));
  let point: Point = { x: object.x, y: object.y };
  for (const parent of from) {
    if (toIds.has(parent.id)) break;
    point = applyTransform(placementTransform(parent.x, parent.y, parent.rotation), point);
  }
  const down: BoardObject[] = [];
  for (const parent of to) {
    if (fromIds.has(parent.id)) break;
    down.push(parent);
  }
  for (const parent of down.reverse()) {
    const toParent = invertTransform(placementTransform(parent.x, parent.y, parent.rotation));
    point = applyTransform(toParent, point);
  }
  return {
    x: finiteCoordinate(point.x),
    y: finiteCoordinate(point.y),
    rotation: rotationIn(frames, object, parentId),
  };
}

/**
 * Where an object goes in a new parent's frame for an origin given on the board.
 *
 * @param frames - A board holding both chains of parents.
 * @param object - The object, as it is now.
 * @param parentId - The new parent, or `null` for the root.
 * @param onBoard - Its origin on the board.
 * @returns The placement, or `null` when a chain of parents forms a cycle.
 */
function placementFromBoard(
  frames: Board,
  object: BoardObject,
  parentId: ObjectId | null,
  onBoard: Point,
): Pick<ReparentPatch, 'x' | 'y' | 'rotation'> | null {
  const local = boardToParentFrame(frames, { ...object, parentId }, onBoard);
  return local === null ? null : { ...local, rotation: rotationIn(frames, object, parentId) };
}

/**
 * The stacking keys of reparented objects: on top of each new parent's children, in the order
 * the board painted them in before (`comparePaintOrder`: objects from different parents are
 * compared along their chains of parents, not by their own keys alone).
 *
 * @param board - The board before the command.
 * @param frames - A board holding the objects' chains of parents.
 * @param requests - The reparents that passed their checks.
 * @param errors - Where to add a refusal when no key fits.
 * @returns The keys by object id (one per id, `generateObjectKeys`); none for a parent where
 *   no key fits.
 */
function keysOnTop(
  board: BoardReader,
  frames: Board,
  requests: readonly ReparentRequest[],
  errors: CommandError[],
): Map<ObjectId, string | undefined> {
  const sorted = [...requests].sort((first, second) =>
    comparePaintOrder(frames, first.object, second.object),
  );
  // The objects going to each parent, bottom first, and the input path of the lowest, which a
  // refusal names.
  const byParent = new Map<
    ObjectId | null,
    { readonly ids: [ObjectId, ...ObjectId[]]; readonly path: readonly (string | number)[] }
  >();
  for (const { object, parentId, path } of sorted) {
    const group = byParent.get(parentId);
    if (group === undefined) byParent.set(parentId, { ids: [object.id], path });
    else group.ids.push(object.id);
  }
  const keys = new Map<ObjectId, string | undefined>();
  for (const [parentId, { ids, path }] of byParent) {
    const placed = zKeysOnTop(board, parentId, ids, [...path, 'parentId'], errors);
    if (placed !== undefined) ids.forEach((id, index) => keys.set(id, placed[index]));
  }
  return keys;
}

/**
 * Gathers what the conversions read: each object's chain of parents and each new parent's.
 *
 * @param board - The board before the command.
 * @param requests - The reparents.
 * @returns The sub-board.
 */
function framesOf(board: BoardReader, requests: readonly ReparentRequest[]): Board {
  const subBoard = new SubBoard(board);
  for (const { object, parentId } of requests) {
    subBoard.addWithAncestors(object.id);
    if (parentId !== null) subBoard.addWithAncestors(parentId);
  }
  return subBoard.toBoard();
}

/**
 * Plans the reparents of one `moveObjects` run: checks each new parent, converts each object's
 * position after the move and its rotation into the new parent's frame (turned and nested
 * frames included, so nothing jumps on screen), and gives the objects keys on top of their new
 * siblings. O(depth) per object plus one top-child lookup per new parent.
 *
 * @param board - The board before the command.
 * @param requests - The objects the move takes into another parent.
 * @param movedIds - Every object the command moves.
 * @param errors - Where to add the refusals.
 * @returns The patch of each reparented object by id; empty when anything was refused.
 */
export function planReparents(
  board: BoardReader,
  requests: readonly ReparentRequest[],
  movedIds: ReadonlySet<ObjectId>,
  errors: CommandError[],
): Map<ObjectId, ReparentPatch> {
  const refusals = requests.flatMap((request) => targetError(board, request, movedIds) ?? []);
  if (refusals.length > 0) {
    errors.push(...refusals);
    return new Map<ObjectId, ReparentPatch>();
  }
  const frames = framesOf(board, requests);
  const keys = keysOnTop(board, frames, requests, refusals);
  const patches = new Map<ObjectId, ReparentPatch>();
  for (const { object, parentId, position, path, onBoard: asked } of requests) {
    // A point on the board comes in only when the current parent cannot hold it; otherwise the
    // place goes through the ancestors the two chains share, never the board (`placementIn`).
    const placement =
      asked === undefined
        ? placementIn(frames, { ...object, ...position }, parentId)
        : placementFromBoard(frames, object, parentId, asked);
    const z = keys.get(object.id);
    if (placement === null) {
      const message = `the ancestors of "${String(parentId)}" form a cycle`;
      refusals.push(commandError('parent-cycle', object.id, [...path, 'parentId'], message));
    } else if (z !== undefined) {
      patches.set(object.id, { parentId, ...placement, z });
    }
  }
  errors.push(...refusals);
  return refusals.length > 0 ? new Map<ObjectId, ReparentPatch>() : patches;
}
