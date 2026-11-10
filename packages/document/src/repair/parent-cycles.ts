import {
  applyTransform,
  compareKeys,
  DEFAULT_PAGE_ID,
  placementTransform,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { normalizeAngle } from '../commands/normalize-angle.js';
import type { DocumentTransaction } from '../store/document-store.js';
import { DocumentWriteError } from '../store/document-write-error.js';

// Two commands, each valid where it ran, can merge into a parent cycle: Ada moves frame F1 into
// frame F2 while Bob moves F2 into F1, and after the merge each placement names the other.
// A plain move of a frame's descendant can close one too (its placement group carries
// the old parent), and a hostile client can write a placement that names its own object. A
// cycle has no board frame: the schema's transforms throw on it and every geometric command
// refuses its members and their contents (`parent-cycle`).
//
// The rule that breaks one (the controller's ruling on): in each cycle, the member with
// the lowest id (UTF-16 order, `compareKeys`) moves to the board root, at the world placement
// found by walking the cycle once from it (its placement composed with each parent's up the
// cycle, the edge that closes the cycle ignored); when that is not finite, at its stored local
// placement. The other members keep their parents, so contents stay with their frames, and
// nothing is deleted. The choice depends only on the stored values of the cycle's members, so
// every client makes the same one. The reader applies it without writing (`store/
// parent-cycle-overlay.ts`), and the repair writes it (`repair-pass.ts`).

/** Reads an object as stored, or `undefined` when there is none or it cannot be read. */
export type StoredObjectLookup = (id: ObjectId) => BoardObject | undefined;

/** One parent cycle and the member it moves to the root. */
export interface ParentCycleBreak {
  /** The cycle's members, sorted by id; the first is the one re-rooted. */
  readonly members: readonly ObjectId[];
  /** The lowest-id member as stored. */
  readonly stored: BoardObject;
  /** The lowest-id member as the break places it: at the root, where the cycle drew it. */
  readonly rerooted: BoardObject;
}

/**
 * Walks up from each start, each object at most once over the whole call, and collects every
 * parent cycle a walk runs into (a walk from below a cycle finds it as well as one from on it).
 *
 * @param lookup - Stored objects.
 * @param starts - Where to start.
 * @returns Each cycle's members, in the order walked: each one's parent is the next, and the
 *   last one's parent is the first.
 */
function findCycles(lookup: StoredObjectLookup, starts: Iterable<ObjectId>): BoardObject[][] {
  const cycles: BoardObject[][] = [];
  const settled = new Set<ObjectId>();
  const path: BoardObject[] = [];
  const indexOnPath = new Map<ObjectId, number>();
  for (const start of starts) {
    path.length = 0;
    indexOnPath.clear();
    let current = lookup(start);
    while (current !== undefined && !settled.has(current.id)) {
      const seenAt = indexOnPath.get(current.id);
      if (seenAt !== undefined) {
        cycles.push(path.slice(seenAt));
        break;
      }
      indexOnPath.set(current.id, path.length);
      path.push(current);
      current = current.parentId === null ? undefined : lookup(current.parentId);
    }
    for (const walked of path) settled.add(walked.id);
  }
  return cycles;
}

/**
 * The world placement of a cycle member found by walking the cycle once from it: its own
 * placement composed with each parent's, up to the member whose parent it is.
 *
 * @param member - The member.
 * @param parents - The other members, from the member's parent up the cycle.
 * @returns The placement, or `undefined` when it is not finite.
 */
function worldPlacementAround(
  member: BoardObject,
  parents: readonly BoardObject[],
): { readonly x: number; readonly y: number; readonly rotation: number } | undefined {
  let placement = { x: member.x, y: member.y, rotation: member.rotation };
  for (const parent of parents) {
    placement = {
      ...applyTransform(placementTransform(parent.x, parent.y, parent.rotation), placement),
      rotation: placement.rotation + parent.rotation,
    };
  }
  const { x, y, rotation } = placement;
  if (![x, y, rotation].every(Number.isFinite)) return undefined;
  return { x, y, rotation: normalizeAngle(rotation) };
}

/**
 * Decides how to break one cycle: its lowest-id member goes to the root, where the cycle drew
 * it, or at its stored local placement when that is not finite.
 *
 * @param cycle - The members in walk order; at least one.
 * @returns The break.
 */
function breakOf(cycle: readonly BoardObject[]): ParentCycleBreak {
  const stored = cycle.reduce((lowest, member) =>
    compareKeys(member.id, lowest.id) < 0 ? member : lowest,
  );
  const start = cycle.indexOf(stored);
  const parents = [...cycle.slice(start + 1), ...cycle.slice(0, start)];
  const { x, y, rotation } = worldPlacementAround(stored, parents) ?? stored;
  const members = Object.freeze(cycle.map(({ id }) => id).sort(compareKeys));
  // No member has a root ancestor to take a page from: the default page, which R1 moves off
  // when it is not live.
  const rerooted: BoardObject = Object.freeze({
    ...stored,
    parentId: null,
    pageId: DEFAULT_PAGE_ID,
    x,
    y,
    rotation,
  });
  return Object.freeze({ members, stored, rerooted });
}

/**
 * Finds the parent cycles that the stored parent chains of the given objects run into, and how
 * to break each (see above). The one shared decision for the reader, which shows the break
 * without writing, and the repair, which writes it. Cost: one walk up from each start, each
 * object visited at most once per call, so it is linear in the objects on the starts' chains of
 * ancestors (a chain with no cycle ends at the root, a missing parent or an unreadable one).
 * Deterministic: the result depends only on the stored values, not on the order of `starts`.
 *
 * @param lookup - Stored objects: the decoded values, before any break is applied.
 * @param starts - The objects whose chains to walk: those a change touched.
 * @returns One break per cycle found, sorted by the re-rooted member's id.
 */
export function findParentCycleBreaks(
  lookup: StoredObjectLookup,
  starts: Iterable<ObjectId>,
): ParentCycleBreak[] {
  return findCycles(lookup, starts)
    .map(breakOf)
    .sort((first, second) => compareKeys(first.rerooted.id, second.rerooted.id));
}

/**
 * Writes cycle breaks: each re-rooted member's placement (`setObject` writes only the groups
 * that changed, so only `placement`; never `updatedAt`, which only a command stamps). The store
 * judges only what a write changes, so a field a peer wrote without validation no
 * longer refuses the break; a break the store still refused would be left as it is, and the
 * reader would keep showing it.
 *
 * @param transaction - The open transaction, with the system origin.
 * @param breaks - The breaks, from {@link findParentCycleBreaks} on the same stored board.
 * @returns The ids written.
 * @throws {unknown} Any error of a write other than the store's refusal of an invalid object.
 */
export function applyParentCycleBreaks(
  transaction: DocumentTransaction,
  breaks: readonly ParentCycleBreak[],
): ObjectId[] {
  const written: ObjectId[] = [];
  for (const { rerooted } of breaks) {
    try {
      transaction.setObject(rerooted);
      written.push(rerooted.id);
    } catch (error) {
      if (!(error instanceof DocumentWriteError)) throw error;
    }
  }
  return written;
}
