import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SplitOptions } from './command.js';
import { OBJECT_WRITES, packByWrites } from './write-budget.js';

/**
 * The most objects one transaction of `createObjects` writes. The collab client sends
 * nothing above 1 MiB in one message (`OUTBOUND_CHUNK_BYTES`), so a paste or import keeps each
 * transaction's update under that: the mixed objects of `createLargeBoardObjects` (frames,
 * stickies, shapes, text, lines, paths, connectors, comments, images) encode to 676–686 bytes
 * each (measured at 100, 1,000 and 5,000 objects), so 1 MiB holds about 1,528 of them; 1,000
 * (about 0.65 MiB) leaves room for heavier ones (long text, many-point paths). A paste of up to
 * 1,000 objects stays one transaction, as before. It is a count, not a byte bound: 1,000 long
 * notes can exceed 1 MiB, and the client then sends that transaction whole, up to its 7 MiB
 * single-transaction limit. `deleteObjects` splits past the same count.
 */
export const MAX_OBJECTS_PER_TRANSACTION = 1_000;

/** What `createObjects` writes: the objects, whole, in input order. */
interface CreatedObjects {
  /** The objects. */
  readonly objects: readonly BoardObject[];
}

/**
 * The listed objects an object refers to: its parent, a connector's attached ends, a comment's
 * anchor, when they are among `listed`.
 *
 * @param object - The object.
 * @param listed - The objects being created, by id.
 * @returns The ids, among `listed`.
 */
function listedReferences(
  object: BoardObject,
  listed: ReadonlyMap<ObjectId, BoardObject>,
): ObjectId[] {
  const ids = object.parentId === null ? [] : [object.parentId];
  if (object.type === 'instance') ids.push(object.mainId);
  if (object.type === 'connector') {
    for (const end of [object.from, object.to]) if (end.kind === 'object') ids.push(end.objectId);
  }
  if (object.type === 'comment' && object.anchor.kind === 'object') {
    ids.push(object.anchor.objectId);
  }
  return ids.filter((id) => listed.has(id));
}

/**
 * Orders objects so each comes after the listed objects it refers to (a parent before its
 * children, a connector's targets and a comment's anchor before it), otherwise in input order:
 * a depth-first walk, iterative so a deep chain of parents cannot overflow the stack. A
 * reference cycle (connectors attached to each other) is broken where the walk meets it.
 *
 * @param objects - The objects, in input order; not mutated.
 * @returns The same objects, ordered.
 */
export function orderByReferences(objects: readonly BoardObject[]): BoardObject[] {
  const listed = new Map(objects.map((object) => [object.id, object]));
  const seen = new Set<ObjectId>();
  const ordered: BoardObject[] = [];
  for (const root of objects) {
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    const stack = [{ object: root, references: listedReferences(root, listed), next: 0 }];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const id = top.references[top.next];
      top.next += 1;
      const target = id === undefined ? undefined : listed.get(id);
      if (id === undefined) {
        stack.pop();
        ordered.push(top.object);
      } else if (target !== undefined && !seen.has(id)) {
        seen.add(id);
        stack.push({ object: target, references: listedReferences(target, listed), next: 0 });
      }
    }
  }
  return ordered;
}

/**
 * Splits what `createObjects` writes into transactions, ordered so every transaction
 * refers only to objects already on the board or written by it or an earlier one: a peer applies
 * each on its own, and its reference repair would detach an object whose parent or target had
 * not arrived. Without a write budget, at most {@link MAX_OBJECTS_PER_TRANSACTION} objects per
 * transaction; with one, at most `maxWrites` planned writes, two per object.
 *
 * @param plan - The objects to create, in input order.
 * @param options - The write budget per part, if any.
 * @param firstReserve - Writes the first part carries besides its objects (a page it creates).
 * @returns The parts, in order, and the command's result (the new ids in input order); or
 *   `undefined` when the plan fits one transaction.
 */
export function splitCreatedObjects(
  plan: CreatedObjects,
  options: SplitOptions = {},
  firstReserve = 0,
): { readonly parts: CreatedObjects[]; readonly result: { readonly ids: ObjectId[] } } | undefined {
  const result = { ids: plan.objects.map((object) => object.id) };
  const { maxWrites } = options;
  if (maxWrites === undefined) {
    if (plan.objects.length <= MAX_OBJECTS_PER_TRANSACTION) return undefined;
    const ordered = orderByReferences(plan.objects);
    const parts: CreatedObjects[] = [];
    for (let start = 0; start < ordered.length; start += MAX_OBJECTS_PER_TRANSACTION) {
      parts.push({ objects: ordered.slice(start, start + MAX_OBJECTS_PER_TRANSACTION) });
    }
    return { parts, result };
  }
  if (plan.objects.length * OBJECT_WRITES + firstReserve <= maxWrites) return undefined;
  const parts = packByWrites(orderByReferences(plan.objects), () => OBJECT_WRITES, maxWrites, {
    first: firstReserve,
  });
  return parts.length < 2 ? undefined : { parts: parts.map((objects) => ({ objects })), result };
}
