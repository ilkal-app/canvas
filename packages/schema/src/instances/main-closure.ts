import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

import { namedSwapTargets } from './effective-slot-main.js';

/** Indexed reads of the whole board that {@link mainClosure} walks. */
export interface DefinitionReader {
  /** Reads a stored object by id, on any page, retired mains included. */
  get(id: ObjectId): BoardObject | undefined;
  /** Lists a container's real direct children, without expanding instances. */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
}

/** The types whose children are definition content. */
const CONTAINERS: ReadonlySet<BoardObject['type']> = new Set(['group', 'frame', 'component']);

/**
 * Everything resolving instances of some mains may read: each root, a
 * container's descendants, each instance's stored main and every main an instance's records or a
 * main's variant presets name as swap targets ({@link namedSwapTargets}), transitively. A superset
 * of what resolution swaps in, so an edit to any main a swap could show reaches the walk's owner.
 * Each id is read once, so a reference cycle stored on the board ends the walk. Pure.
 *
 * @param reader - The whole board's indexed reads.
 * @param roots - The ids to start from: mains, or instances whose own records name swaps.
 * @returns The ids reached, in first-reached order (a container before its children); ids named
 *   but missing from the board are included, so their creation can be watched.
 */
export function mainClosure(reader: DefinitionReader, roots: Iterable<ObjectId>): Set<ObjectId> {
  const closure = new Set<ObjectId>();
  const pending = [...roots];
  // Ids pushed while iterating are visited too, in order.
  for (const id of pending) {
    if (closure.has(id)) continue;
    closure.add(id);
    const object = reader.get(id);
    if (object === undefined) continue;
    if (object.type === 'instance') pending.push(object.mainId);
    pending.push(...namedSwapTargets(object));
    if (CONTAINERS.has(object.type)) pending.push(...reader.childrenOf(id));
  }
  return closure;
}
