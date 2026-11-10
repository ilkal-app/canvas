import { namedSwapTargets, type BoardObject, type ObjectId } from '@canvas/schema';

import type { BoardReader } from './command.js';

/**
 * Who names each main as a swap target: the instances whose own records do and the
 * mains whose variant presets do (`namedSwapTargets`). Built from one read of the board, so a
 * swap check scans the board once per command; the reverse indexes hold no such entry.
 *
 * @param reader - The board.
 * @returns The referrers' ids by named main; empty for a reader that cannot read the board.
 */
function swapReferrers(reader: BoardReader): ReadonlyMap<ObjectId, readonly ObjectId[]> {
  const referrers = new Map<ObjectId, ObjectId[]>();
  for (const object of reader.read?.().objects.values() ?? []) {
    for (const mainId of new Set(namedSwapTargets(object))) {
      const ids = referrers.get(mainId) ?? [];
      ids.push(object.id);
      referrers.set(mainId, ids);
    }
  }
  return referrers;
}

/**
 * The mains that contain an object: every main among its ancestors and, transitively,
 * every main among the ancestors of an instance of such a main, of an instance whose records
 * swap a slot to such a main, or a main whose presets do. Expanding any of them may expand the
 * object, so a swap inside the object (an instance) must never reach one: that is a cycle.
 * Instances come from the reverse index; swaps from one scan of the board, made only when a
 * containing main is found.
 *
 * @param reader - The board, before the command.
 * @param object - The object, stored or planned (a planned instance is read through its own
 *   `parentId`).
 * @returns The containing mains' ids.
 */
export function containingMains(reader: BoardReader, object: BoardObject): ReadonlySet<ObjectId> {
  const found = new Set<ObjectId>();
  const visited = new Set<ObjectId>();
  const pending: ObjectId[] = [];
  let referrers: ReadonlyMap<ObjectId, readonly ObjectId[]> | undefined;
  const climb = (start: BoardObject | undefined): void => {
    let current = start;
    // A visited object's ancestors are already walked; this also ends a parent or swap cycle.
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.type === 'component') {
        found.add(current.id);
        referrers ??= swapReferrers(reader);
        pending.push(
          ...reader.references.instancesOf(current.id),
          ...(referrers.get(current.id) ?? []),
        );
      }
      current = current.parentId === null ? undefined : reader.get(current.parentId);
    }
  };
  climb(object);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) climb(reader.get(id));
  return found;
}
