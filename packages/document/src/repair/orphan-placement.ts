import {
  applyTransform,
  compareSiblings,
  BOARD_BOUND,
  finiteCoordinate,
  isValidKey,
  MAX_KEY_LENGTH,
  placementTransform,
  type BoardObject,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { normalizeAngle } from '../commands/normalize-angle.js';
import { generateObjectKeys } from '../z-order/object-keys.js';

/**
 * The rotation a re-rooted object stores: the sum of its own and its removed ancestors', as it is
 * while it is within the limit every write and copy holds a rotation to (±`BOARD_BOUND`,
 * `angleSchema`); a sum past that, or an infinity, which only rotations a peer stored past the
 * limit can make, is wrapped into (−π, π] (`normalizeAngle`; an infinity becomes 0). The repair's
 * write is sent like any local one, and a new value the door refuses would close the connection;
 * a rotation past the limit, which the door takes, would refuse every copy of the
 * object (a page duplicated after a group a peer turned to 2^31 was removed).
 *
 * @param sum - The summed rotation, radians.
 * @returns The rotation to store.
 */
function composedRotation(sum: number): number {
  return Math.abs(sum) <= BOARD_BOUND ? sum : normalizeAngle(sum);
}

/**
 * Moves an object whose parent is gone to its nearest surviving ancestor, composing the removed
 * ancestors' placements (as they were last seen) into its own, as `ungroup` does, so it stays
 * where it is on the board (coordinates are relative to the parent),
 * landing on the root on its removed root ancestor's page (R2). An
 * ancestor nothing is known of ends the walk at the board root, keeping the object's
 * coordinates; so does a remembered chain of parents that loops.
 *
 * @param object - The object.
 * @param before - A board that still holds the removed ancestors (a `LastKnownBoard`).
 * @param isPresent - Whether an object is on the board now.
 * @returns The object, re-parented, or itself when its parent is present.
 */
export function reroot(
  object: BoardObject,
  before: BoardReader,
  isPresent: (id: ObjectId) => boolean,
): BoardObject {
  let placement = { x: object.x, y: object.y, rotation: object.rotation };
  let parentId = object.parentId;
  // R2: an orphan landing on the root takes its removed root ancestor's page; none
  // known leaves it to the store, which puts it on the first page, and R1 moves it off a page
  // that is not live.
  let pageId: PageId | null | undefined = null;
  const walked = new Set<ObjectId>();
  while (parentId !== null && !isPresent(parentId)) {
    const parent = before.get(parentId);
    if (parent === undefined || walked.has(parentId)) {
      parentId = null;
      pageId = undefined;
      break;
    }
    pageId = parent.parentId === null ? parent.pageId : null;
    walked.add(parentId);
    const toGrandparent = placementTransform(parent.x, parent.y, parent.rotation);
    const placed = applyTransform(toGrandparent, placement);
    placement = {
      x: finiteCoordinate(placed.x),
      y: finiteCoordinate(placed.y),
      rotation: composedRotation(placement.rotation + parent.rotation),
    };
    parentId = parent.parentId;
  }
  if (parentId === object.parentId) return object;
  const rerooted: BoardObject = { ...object, ...placement, parentId, pageId: null };
  if (parentId !== null) return rerooted;
  if (pageId !== null && pageId !== undefined) return { ...rerooted, pageId };
  // No page known: the store settles it on the first page (`store/placed-page.ts`).
  const unsettled: Partial<BoardObject> = { ...rerooted };
  delete unsettled.pageId;
  return unsettled as BoardObject;
}

/**
 * Keys above a parent's top key, one per object, or `undefined` when the top key is not a
 * fractional-index key (a peer that skipped validation) or a key would be too long.
 *
 * @param top - The parent's top child's key, or `null` when it has none.
 * @param ids - The objects, bottom first.
 * @returns The keys, ascending, or `undefined`.
 */
function keysAbove(top: string | null, ids: readonly ObjectId[]): string[] | undefined {
  if (top !== null && !isValidKey(top)) return undefined;
  const keys = generateObjectKeys(top, null, ids);
  return keys.every((key) => key.length <= MAX_KEY_LENGTH) ? keys : undefined;
}

/**
 * Puts re-parented objects on top of their new parent's children, keeping their relative
 * order (by `z`, ties by id: the sibling order, `compareSiblings`), with fresh keys above the
 * parent's top child, so they cannot interleave with its children by accident of the keys they
 * had under another parent. Deterministic: the same objects and top keys give the same keys on
 * every client. Objects whose parent did not change keep their key; so do the objects of a
 * parent whose top key cannot be built on.
 *
 * @param objects - The repaired objects.
 * @param previousParents - Each object's parent before the repair, by id.
 * @param board - The board the new parents' top children are read from.
 * @returns The objects, re-keyed where they changed parent, in the order given.
 */
export function placeOnTop(
  objects: readonly BoardObject[],
  previousParents: ReadonlyMap<ObjectId, ObjectId | null>,
  board: BoardReader,
): BoardObject[] {
  const byParent = new Map<ObjectId | null, BoardObject[]>();
  for (const object of objects) {
    if (previousParents.get(object.id) === object.parentId) continue;
    const moved = byParent.get(object.parentId) ?? [];
    moved.push(object);
    byParent.set(object.parentId, moved);
  }
  const keyed = new Map<ObjectId, string>();
  for (const [parentId, moved] of byParent) {
    const ids = [...moved].sort(compareSiblings).map(({ id }) => id);
    const top = board.references.topChildOf(parentId);
    const keys = keysAbove((top === undefined ? undefined : board.get(top)?.z) ?? null, ids);
    ids.forEach((id, index) => {
      const key = keys?.[index];
      if (key !== undefined) keyed.set(id, key);
    });
  }
  return objects.map((object) => {
    const z = keyed.get(object.id);
    return z === undefined ? object : { ...object, z };
  });
}
