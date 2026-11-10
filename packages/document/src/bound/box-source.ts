import type { BoardObject, ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';

/**
 * What the board's bound reads of a board: objects by id and each one's children. The
 * store (`boxSourceOf`), a board a command would leave (`overlaySource`), a relay's scratch copy
 * of a board, the select tool's document, all read alike.
 */
export interface BoxSource {
  /**
   * An object by id.
   *
   * @param id - The object's id.
   * @returns The object, or `undefined` when there is none.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * The ids of an object's children.
   *
   * @param id - The parent's id.
   * @returns The children's ids, in no particular order.
   */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
}

/**
 * A store, or anything a command reads, as a {@link BoxSource}.
 *
 * @param reader - The board, read one object at a time and through its reverse indexes.
 * @returns The source.
 */
export function boxSourceOf(reader: BoardReader): BoxSource {
  return {
    get: (id) => reader.get(id),
    childrenOf: (id) => reader.references.childrenOf(id),
  };
}

/**
 * A board with writes laid over it: what a command would leave (`previewCommand`), read without
 * writing anything. An object written `null` is deleted; one whose parent changed is a child of
 * its new parent and no longer of its old one.
 *
 * @param base - The board before the writes.
 * @param written - The objects written, whole, by id; `null` for one deleted.
 * @returns The board after the writes.
 */
export function overlaySource(
  base: BoxSource,
  written: ReadonlyMap<ObjectId, BoardObject | null>,
): BoxSource {
  const moved = new Set<ObjectId>();
  const added = new Map<ObjectId, ObjectId[]>();
  for (const [id, object] of written) {
    const parentBefore = base.get(id)?.parentId;
    const parentAfter = object === null ? undefined : object.parentId;
    if (parentAfter === parentBefore) continue;
    moved.add(id);
    if (parentAfter === undefined || parentAfter === null) continue;
    const siblings = added.get(parentAfter);
    if (siblings === undefined) added.set(parentAfter, [id]);
    else siblings.push(id);
  }
  return {
    get: (id) => (written.has(id) ? (written.get(id) ?? undefined) : base.get(id)),
    childrenOf: (id) => {
      if (moved.size === 0) return base.childrenOf(id);
      const kept = [...base.childrenOf(id)].filter((child) => !moved.has(child));
      return [...kept, ...(added.get(id) ?? [])];
    },
  };
}
