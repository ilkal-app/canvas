import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { definitionContent } from './definition-content.js';
import { MAX_INSTANCE_DEPTH } from './instance-limits.js';

// Instance swap: an outer override record may name another main for a nested instance
// (a slot). The swap renders only while its target can be expanded where the slot sits; otherwise
// the slot's stored main renders and the record is kept, so restoring the target restores the
// swap. Pure.

/**
 * How many definition levels expanding a main takes, itself included, following the stored mains
 * of its nested instances; `Infinity` when the expansion would reach a cycle or one of the
 * excluded mains. A nested main that is missing or not a main ends that branch, as expansion
 * stops there with its own issue.
 *
 * @param board - The source board.
 * @param children - The board's child index.
 * @param excluded - Mains already expanded above the slot.
 * @param limit - The most levels worth counting; counting stops once it is passed.
 * @returns A function from a main id to its expansion height.
 */
function heightOf(
  board: Board,
  children: ChildIndex,
  excluded: readonly ObjectId[],
  limit: number,
): (mainId: ObjectId) => number {
  const known = new Map<ObjectId, number>();
  const active = new Set<ObjectId>();
  const height = (mainId: ObjectId): number => {
    if (excluded.includes(mainId) || active.has(mainId)) return Infinity;
    const found = known.get(mainId);
    if (found !== undefined) return found;
    if (board.objects.get(mainId)?.type !== 'component') return 0;
    active.add(mainId);
    let deepest = 0;
    for (const object of definitionContent(board, mainId, children)) {
      if (object.type === 'instance') deepest = Math.max(deepest, height(object.mainId));
      if (deepest >= limit) break;
    }
    active.delete(mainId);
    known.set(mainId, deepest + 1);
    return deepest + 1;
  };
  return height;
}

/** Why a slot cannot show a swapped-in main where it sits. */
export type SlotSwapIssue =
  'missing-main' | 'invalid-main' | 'retired-main' | 'instance-cycle' | 'instance-depth';

/**
 * The mains an object's stored records name as swap targets, at any path: an
 * instance's own override records, or every variant preset of a main, selected by
 * some instance or not. A superset of what any expansion swaps in, for checks that must be
 * strict; empty for other objects.
 *
 * @param object - The object; not changed.
 * @returns The named mains, possibly with repeats.
 */
export function namedSwapTargets(object: BoardObject): ObjectId[] {
  const maps =
    object.type === 'instance'
      ? [object.overrides]
      : object.type === 'component'
        ? Object.values(object.variantPresets ?? {})
        : [];
  return maps.flatMap((records) =>
    Object.values(records).flatMap(({ mainId }) => (mainId === undefined ? [] : [mainId])),
  );
}

/**
 * Whether expanding a main could reach one of `excluded`, following the stored main of each
 * nested instance and every main its records, or a visited main's presets, name as a swap target
 * ({@link namedSwapTargets}); each main is read once, so a cycle stored on the board ends the
 * walk. Stricter than resolution, which follows a swap only where it can expand.
 *
 * @param board - The source board.
 * @param children - The board's child index.
 * @param mainId - The main expanded first.
 * @param excluded - The mains that must not be reached.
 * @returns Whether one is reached, `mainId` itself included.
 */
function reachesAny(
  board: Board,
  children: ChildIndex,
  mainId: ObjectId,
  excluded: ReadonlySet<ObjectId>,
): boolean {
  const seen = new Set<ObjectId>();
  const pending = [mainId];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (excluded.has(next)) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    const main = board.objects.get(next);
    if (main !== undefined) pending.push(...namedSwapTargets(main));
    for (const object of definitionContent(board, next, children))
      if (object.type === 'instance') pending.push(object.mainId, ...namedSwapTargets(object));
  }
  return false;
}

/**
 * Why a main cannot be swapped into a slot expanded under `ancestorMains`, or `undefined` when
 * it can: it must be a component on the board (`missing-main`, `invalid-main`) that is not
 * retired (`retired-main`), and expanding it there must make no cycle (`instance-cycle`) and stay
 * within {@link MAX_INSTANCE_DEPTH}, counting its own nested instances (`instance-depth`). The
 * one rule {@link effectiveSlotMain} reads by and commands refuse by, so the two never disagree.
 * The slot's `swapOptions` are not checked here.
 *
 * A writer also passes `excluded`: the mains that contain the instance being overridden, through
 * its parents and, transitively, through instances of such mains or swaps to them. The target
 * may then not reach those mains or `ancestorMains` even through a swap stored on the board
 * (`instance-cycle`), even where the board read does not yet hold the instance; they never count
 * toward depth, which is counted from the instance's own main as resolution counts it. Reading
 * passes none: the expansion that contains the instance finds the cycle through its ancestors,
 * and a swap that would close one falls back.
 *
 * @param board - The source board; not changed.
 * @param target - The main to swap in.
 * @param ancestorMains - The mains expanded above the slot, outermost first; not changed.
 * @param children - An optional existing child index of the whole board.
 * @param excluded - For a write, further mains the target must not reach; omitted on read.
 * @returns The issue, or `undefined` when the slot may expand `target`.
 */
export function slotSwapIssue(
  board: Board,
  target: ObjectId,
  ancestorMains: readonly ObjectId[],
  children: ChildIndex = buildChildIndex(board),
  excluded?: ReadonlySet<ObjectId>,
): SlotSwapIssue | undefined {
  const main = board.objects.get(target);
  if (main === undefined) return 'missing-main';
  if (main.type !== 'component') return 'invalid-main';
  if (main.retired) return 'retired-main';
  if (
    excluded !== undefined &&
    reachesAny(board, children, target, new Set([...excluded, ...ancestorMains]))
  )
    return 'instance-cycle';
  const room = MAX_INSTANCE_DEPTH - ancestorMains.length;
  const height = heightOf(board, children, ancestorMains, room)(target);
  if (height === Infinity) return 'instance-cycle';
  return height > room ? 'instance-depth' : undefined;
}

/**
 * The main a nested instance (a slot) expands in its enclosing instance: its record's swapped-in
 * `mainId` when {@link slotSwapIssue} finds nothing wrong with it under the mains already
 * expanded; otherwise the slot's stored `mainId`. The slot's `swapOptions` are not checked here:
 * commands enforce them, reading does not.
 *
 * @param board - The source board; not changed.
 * @param slot - The nested source instance; not changed.
 * @param record - Its effective override record in the enclosing instance, if any.
 * @param record.mainId - The swapped-in main, if any.
 * @param ancestorMains - The mains expanded above the slot, outermost first; not changed.
 * @param children - An optional existing child index of the whole board.
 * @returns The id of the main to expand.
 */
export function effectiveSlotMain(
  board: Board,
  slot: InstanceObject,
  record: Readonly<{ mainId?: ObjectId | undefined }> | undefined,
  ancestorMains: readonly ObjectId[],
  children?: ChildIndex,
): ObjectId {
  const target = record?.mainId;
  if (target === undefined || target === slot.mainId) return slot.mainId;
  return slotSwapIssue(board, target, ancestorMains, children) === undefined ? target : slot.mainId;
}
