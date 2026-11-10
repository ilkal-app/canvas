import {
  compareSiblings,
  isValidKey,
  MAX_KEY_LENGTH,
  type ObjectId,
  type SiblingKey,
} from '@canvas/schema';

import { describeValue } from '../codec/describe-value.js';

import { generateObjectKeys } from './object-keys.js';
import { readSiblingKeys, type SiblingReader } from './sibling-order.js';

/** The four order moves: bring to front, send to back, bring forward, send backward. */
export const REORDER_DIRECTIONS = ['front', 'back', 'forward', 'backward'] as const;

/** One order move: to the front or back of the siblings, or one step forward or backward. */
export type ReorderDirection = (typeof REORDER_DIRECTIONS)[number];

/** Why a reorder cannot be planned. */
export const REORDER_ISSUE_CODES = [
  'missing-object',
  'mixed-parents',
  'unorderable-neighbours',
  'key-too-long',
] as const;

/** One of {@link REORDER_ISSUE_CODES}. */
export type ReorderIssueCode = (typeof REORDER_ISSUE_CODES)[number];

/** A reason a reorder was refused, with the objects it concerns. */
export interface ReorderIssue {
  /** What went wrong. */
  readonly code: ReorderIssueCode;
  /** A sentence for people and agents. */
  readonly message: string;
  /** The objects concerned. */
  readonly ids: readonly ObjectId[];
}

/** A reorder that can be made: the new keys. */
export interface ReorderPlan {
  /** The parent whose children move. */
  readonly parentId: ObjectId | null;
  /** The new key of every object whose key changes; empty when nothing moves. */
  readonly keys: ReadonlyMap<ObjectId, string>;
}

/** A reorder that is refused, and why. */
export interface ReorderRefusal {
  /** Why; at least one issue. */
  readonly issues: readonly ReorderIssue[];
}

/**
 * Places a run of siblings between two keys, keeping the run's order.
 *
 * @param run - The siblings, bottom first.
 * @param lower - The key to sort above, or `null`.
 * @param upper - The key to sort below, or `null`.
 * @returns The siblings with their new keys, or the issue that prevents the move.
 */
function place(
  run: readonly SiblingKey[],
  lower: string | null,
  upper: string | null,
): SiblingKey[] | ReorderIssue {
  const ids = run.map((sibling) => sibling.id);
  const hasValidBounds =
    (lower === null || isValidKey(lower)) &&
    (upper === null || isValidKey(upper)) &&
    (lower === null || upper === null || lower < upper);
  if (!hasValidBounds) {
    return {
      code: 'unorderable-neighbours',
      message: `No key fits between the neighbours' keys ${describeValue(lower)} and ${describeValue(upper)}`,
      ids,
    };
  }
  const keys = generateObjectKeys(lower, upper, ids);
  if (keys.some((key) => key.length > MAX_KEY_LENGTH)) {
    return {
      code: 'key-too-long',
      message: `The new keys would exceed ${String(MAX_KEY_LENGTH)} characters`,
      ids,
    };
  }
  return run.map((sibling, index) => ({ id: sibling.id, z: keys[index] ?? sibling.z }));
}

/**
 * Moves the selected siblings as one block to the front or the back. One pass finds the block
 * and the unselected sibling at that end; only the block is sorted, so a front or back move
 * among n siblings costs O(n), not O(n log n).
 *
 * @param siblings - The siblings, in any order.
 * @param isSelected - Whether a sibling moves.
 * @param end - Which end of the order the block moves to.
 * @returns The moved siblings with new keys (none when the block is already there), or an issue.
 */
function moveToEnd(
  siblings: readonly SiblingKey[],
  isSelected: (id: ObjectId) => boolean,
  end: 'front' | 'back',
): SiblingKey[] | ReorderIssue {
  const isFront = end === 'front';
  const block: SiblingKey[] = [];
  // The unselected sibling nearest the end: the top one for the front, the bottom one for the back.
  let edge: SiblingKey | undefined;
  for (const sibling of siblings) {
    if (isSelected(sibling.id)) block.push(sibling);
    else if (edge === undefined || compareSiblings(sibling, edge) > 0 === isFront) edge = sibling;
  }
  block.sort(compareSiblings);
  const inner = isFront ? block[0] : block.at(-1);
  if (edge === undefined || inner === undefined) return [];
  if (isFront) return compareSiblings(edge, inner) < 0 ? [] : place(block, edge.z, null);
  return compareSiblings(inner, edge) < 0 ? [] : place(block, null, edge.z);
}

/**
 * Whether the sibling at a position of a working order is selected; `false` out of range.
 *
 * @param order - The working order.
 * @param position - The position.
 * @param isSelected - Whether a sibling moves.
 * @returns `true` for a selected sibling.
 */
function isSelectedAt(
  order: readonly SiblingKey[],
  position: number,
  isSelected: (id: ObjectId) => boolean,
): boolean {
  const sibling = order[position];
  return sibling !== undefined && isSelected(sibling.id);
}

/**
 * Moves every maximal run of selected siblings one step forward, above the unselected sibling
 * directly above it, starting with the topmost run so a lower run lands next to a moved one.
 *
 * @param order - The siblings, bottom to top.
 * @param isSelected - Whether a sibling moves.
 * @returns The moved siblings with new keys, or an issue.
 */
function moveForward(
  order: readonly SiblingKey[],
  isSelected: (id: ObjectId) => boolean,
): SiblingKey[] | ReorderIssue {
  const working = [...order];
  const moved: SiblingKey[] = [];
  let index = working.length - 1;
  while (index >= 0) {
    if (!isSelectedAt(working, index, isSelected)) {
      index -= 1;
      continue;
    }
    const end = index;
    while (isSelectedAt(working, index, isSelected)) index -= 1;
    const start = index + 1;
    const hop = working[end + 1];
    if (hop === undefined) continue;
    const placed = place(working.slice(start, end + 1), hop.z, working[end + 2]?.z ?? null);
    if (!Array.isArray(placed)) return placed;
    working.splice(start, end - start + 2, hop, ...placed);
    moved.push(...placed);
  }
  return moved;
}

/**
 * Moves every maximal run of selected siblings one step backward, below the unselected sibling
 * directly below it, starting with the bottom run.
 *
 * @param order - The siblings, bottom to top.
 * @param isSelected - Whether a sibling moves.
 * @returns The moved siblings with new keys, or an issue.
 */
function moveBackward(
  order: readonly SiblingKey[],
  isSelected: (id: ObjectId) => boolean,
): SiblingKey[] | ReorderIssue {
  const working = [...order];
  const moved: SiblingKey[] = [];
  let index = 0;
  while (index < working.length) {
    if (!isSelectedAt(working, index, isSelected)) {
      index += 1;
      continue;
    }
    const start = index;
    while (isSelectedAt(working, index, isSelected)) index += 1;
    const end = index - 1;
    const hop = working[start - 1];
    if (hop === undefined) continue;
    const placed = place(working.slice(start, end + 1), working[start - 2]?.z ?? null, hop.z);
    if (!Array.isArray(placed)) return placed;
    working.splice(start - 1, end - start + 2, ...placed, hop);
    moved.push(...placed);
  }
  return moved;
}

/**
 * Applies one order move to the siblings.
 *
 * @param siblings - The siblings, in any order.
 * @param isSelected - Whether a sibling moves.
 * @param direction - The move.
 * @returns The moved siblings with new keys, or an issue.
 */
function moveSiblings(
  siblings: readonly SiblingKey[],
  isSelected: (id: ObjectId) => boolean,
  direction: ReorderDirection,
): SiblingKey[] | ReorderIssue {
  switch (direction) {
    case 'front':
    case 'back':
      return moveToEnd(siblings, isSelected, direction);
    case 'forward':
      return moveForward([...siblings].sort(compareSiblings), isSelected);
    case 'backward':
      return moveBackward([...siblings].sort(compareSiblings), isSelected);
  }
}

/**
 * Checks that every object exists and that they share one parent.
 *
 * @param store - The document.
 * @param ids - The distinct objects to move.
 * @returns Their parent, or the issue that prevents the move.
 */
function findParent(
  store: SiblingReader,
  ids: readonly ObjectId[],
): { readonly parentId: ObjectId | null } | ReorderIssue {
  const missing = ids.filter((id) => store.get(id) === undefined);
  if (missing.length > 0) {
    return { code: 'missing-object', message: 'Some objects do not exist', ids: missing };
  }
  const parents = new Set(ids.map((id) => store.get(id)?.parentId ?? null));
  if (parents.size > 1) {
    return {
      code: 'mixed-parents',
      message: 'Objects can only be reordered among siblings: they must share one parent',
      ids,
    };
  }
  return { parentId: [...parents][0] ?? null };
}

/**
 * Plans an order move over objects that share one parent: the new
 * key of every object that moves, computed from the store's last completed transaction and
 * written nowhere. Only the moved objects get new keys (from `generateObjectKeys`), so a
 * concurrent move of other siblings on another client merges with this one. Deterministic: the
 * same store state and input always give the same plan, so a command can plan in `validate`
 * and again in `apply`.
 *
 * - `front` / `back`: the objects move as one block above (below) every other sibling,
 *   keeping their relative order; nothing changes when they are already there.
 * - `forward` / `backward`: each maximal run of selected siblings hops over the unselected
 *   sibling directly above (below) it, keeping its order; a run already at the end stays.
 *
 * @param store - The document.
 * @param ids - The objects to move; repeats count once.
 * @param direction - The move.
 * @returns The plan, or the issues that refuse it.
 */
export function planReorder(
  store: SiblingReader,
  ids: readonly ObjectId[],
  direction: ReorderDirection,
): ReorderPlan | ReorderRefusal {
  const distinct = [...new Set(ids)];
  const parent = findParent(store, distinct);
  if ('code' in parent) return { issues: [parent] };
  const selected = new Set(distinct);
  const isSelected = (id: ObjectId) => selected.has(id);
  const moved = moveSiblings(readSiblingKeys(store, parent.parentId), isSelected, direction);
  if (!Array.isArray(moved)) return { issues: [moved] };
  return {
    parentId: parent.parentId,
    keys: new Map(moved.map((sibling) => [sibling.id, sibling.z])),
  };
}
