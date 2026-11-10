import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import {
  currentValueOf,
  isRefusedAtDoor,
  referenceOf,
  restoresOf,
  type Restore,
} from './door-restores.js';
import type { UndoStep } from './field-guard.js';
import { lastCopyOf, withoutRestores } from './restore-guard.js';

// (blocks production). Commands write only values the relay's door accepts (
// item 1), but an undo or redo writes back whatever its step removed, and a board can hold a
// value the door refuses (stored before the door existed, or arriving by a path no door sees): a
// peer leaves a width of 2^40, Ada resizes it to 10 and undoes, and the restore writes 2^40 again;
// the door refuses the update and closes Ada's connection for good (4426 `hostile-values`), and
// her cache replays the restore on every reconnect. So no undo or redo writes a value the door
// would refuse (`door-restores.ts`: the door's own key table and predicate, and its rule that a
// field equal to what the board holds passes). The guard runs inside the undo or redo
// transaction, before Yjs applies the step (one part of a grouped step at a time), and
// hands Yjs the step without the refused restores, so the update the step makes holds none:
//
// - A value restored into an object on the board (a size, a placement, a crop, a line end, a
//   network member) that the door would refuse is left out, and the key keeps its current value
//   (the step's own value included, which Yjs would otherwise delete and leave the field empty).
//   A refused network member freezes both networks of its object for the step (no member of
//   them is restored or removed), so no segment is left ending at a vertex left out.
// - An object the step re-creates (the undo of a delete, the redo of a creation) holding a value
//   the door would refuse is not re-created: in part it could not be read, and the field guard
//   would refill the missing field with the very value refused (`restoreEmptiedFields`). Only
//   that object is left out (fix round 1): what the step re-creates that refers to it (its
//   children, a connector attached to it, a comment pinned on it) is re-created, and the
//   history's reference repair, in the same transaction, re-roots the children where they were
//   on the board and detaches the connector ends and pins, as for any referent that is gone
//   (`undo-manager.ts`, `repair/orphan-placement.ts`; its coordinates go through
//   `finiteCoordinate` and its rotation stays within float32, so what it writes passes the door).
//   A reference to it the step would write back into an object already on the board (a connector
//   end, a pin, a child's parent) is left out, so the connector stays detached and the comment a
//   point pin, as the delete left them. In a grouped step the objects an earlier part left out
//   count for the later parts.
//
// The rest of the step applies; the step is used up, and what Yjs pushes on the other stack is
// only what was applied, so a redo never replays what was left out. The person is told
// (`UndoHistory.lastOmission`, `'out-of-range'`, and `UndoHistory.lastOmittedObjects`, how many
// whole objects were not brought back). Cost: one pass over the step's removed
// structs; the predicate runs only on values under judged keys, and reads the board only for a
// value it would refuse. Never the board.

/** Why an undo or redo left part of its step out, for the person to be told. */
export type UndoOmission = 'out-of-range';

/**
 * Remembers, while one undo or redo runs, what it must keep because a restore was left out, for
 * the history's delete filter; and whether any undo or redo since the person's last click left
 * something out. Single-threaded.
 */
export class DoorGuard {
  readonly #objects: Y.Map<unknown>;
  /** The current values kept, and the network maps frozen, for the step being applied. */
  #kept = new Set<Y.Item>();
  /** The objects earlier parts of a grouped step left out; `undefined` outside a group. */
  #groupLeftOut: Set<ObjectId> | undefined;
  #omission: UndoOmission | undefined;
  #omittedObjects = 0;

  /**
   * Creates the guard of one history.
   *
   * @param objects - The document's objects map.
   */
  constructor(objects: Y.Map<unknown>) {
    this.#objects = objects;
  }

  /**
   * Why the undo or redo since {@link DoorGuard.clearOmission} left part of its step out.
   *
   * @returns `'out-of-range'`, or `undefined` when it left nothing out for the door.
   */
  get omission(): UndoOmission | undefined {
    return this.#omission;
  }

  /**
   * How many whole objects the undo or redo since {@link DoorGuard.clearOmission} did not
   * re-create because they hold a value the door refuses.
   *
   * @returns The count, 0 when it re-created every object it could.
   */
  get omittedObjects(): number {
    return this.#omittedObjects;
  }

  /** Forgets the last omission; call when the person asks for an undo or redo. */
  clearOmission(): void {
    this.#omission = undefined;
    this.#omittedObjects = 0;
  }

  /**
   * Decides what a step about to be applied leaves out. Call inside the undo or redo
   * transaction, before Yjs applies the step; then {@link DoorGuard.keeps} answers for it until
   * {@link DoorGuard.end}.
   *
   * @param transaction - The open transaction.
   * @param step - The step as the other guards hand it on.
   * @returns The step without the restores the door would refuse (`step` when there are none).
   */
  begin(transaction: Y.Transaction, step: UndoStep): UndoStep {
    this.#kept = new Set();
    const objects = this.#objects;
    const { recreated, values } = restoresOf(transaction, step, objects);
    const refused = new Set<ObjectId>();
    const refusedLive: Restore[] = [];
    for (const restore of values) {
      if (!isRefusedAtDoor(restore, objects)) continue;
      const id = restore.field.objectId as ObjectId;
      if (recreated.get(id) === restore.entry) refused.add(id);
      else refusedLive.push(restore);
    }
    const earlier = this.#groupLeftOut ?? new Set<ObjectId>();
    if (refused.size === 0 && refusedLive.length === 0 && earlier.size === 0) return step;
    const leftOut = new Set([...earlier, ...refused]);
    const blocked = this.#leaveOutLive(transaction.doc.store, values, refusedLive, leftOut);
    for (const id of refused) {
      const entry = recreated.get(id);
      if (entry !== undefined) blocked.push(entry);
      this.#groupLeftOut?.add(id);
    }
    this.#omittedObjects += refused.size;
    if (blocked.length > 0) this.#omission = 'out-of-range';
    return withoutRestores(step, blocked);
  }

  /**
   * Tells whether the step being applied must keep an item: the item is, or lies inside, a
   * value kept because its key's restore was left out. Cost: a walk up the item's owners to its
   * object.
   *
   * @param item - An item Yjs is about to delete.
   * @returns `true` to keep it.
   */
  keeps(item: Y.Item): boolean {
    if (this.#kept.size === 0) return false;
    for (let entry = item; entry.parent !== this.#objects;) {
      if (this.#kept.has(entry)) return true;
      const owner = (entry.parent as Y.AbstractType<unknown>)._item;
      if (owner === null) return false;
      entry = owner;
    }
    return false;
  }

  /** Forgets the step, once it has been applied. */
  end(): void {
    this.#kept = new Set();
  }

  /** Starts an undo or redo of a step written in parts. */
  beginGroup(): void {
    this.#groupLeftOut = new Set();
  }

  /** Ends the undo or redo of a step written in parts. */
  endGroup(): void {
    this.#groupLeftOut = undefined;
  }

  /**
   * The restores into objects on the board to leave out: those the door would refuse, every
   * member restore of an object with a refused member (its networks frozen), and every
   * reference to an object left out; keeps their keys' current values.
   *
   * @param store - The document's struct store.
   * @param values - The values the step restores.
   * @param refusedLive - Those into objects on the board that the door would refuse.
   * @param leftOut - The objects not re-created.
   * @returns The items to leave out of the step.
   */
  #leaveOutLive(
    store: Y.Doc['store'],
    values: readonly Restore[],
    refusedLive: readonly Restore[],
    leftOut: ReadonlySet<ObjectId>,
  ): Y.Item[] {
    const refused = new Set(refusedLive);
    const frozen = new Set(
      refusedLive.flatMap((restore) =>
        restore.field.memberId === undefined ? [] : [restore.field.objectId],
      ),
    );
    const blocked: Y.Item[] = [];
    for (const restore of values) {
      const live = lastCopyOf(restore.entry, store);
      if (live.deleted) continue;
      const referred = referenceOf(restore);
      const isLeftOut =
        refused.has(restore) ||
        (restore.field.memberId !== undefined && frozen.has(restore.field.objectId)) ||
        (referred !== undefined && leftOut.has(referred));
      if (!isLeftOut) continue;
      blocked.push(restore.item);
      const current = currentValueOf(live, restore.field);
      if (current !== undefined) this.#kept.add(current);
    }
    for (const id of frozen) {
      const live = this.#objects._map.get(id);
      for (const key of ['vertices', 'segments']) {
        const network =
          live === undefined ? undefined : currentValueOf(live, { objectId: id, key });
        if (network !== undefined) this.#kept.add(network);
      }
    }
    return blocked;
  }
}
