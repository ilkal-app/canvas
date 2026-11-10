import * as Y from 'yjs';

import type { UndoStep } from './field-guard.js';

// Yjs's `redoItem` (13.6.33) follows a value's re-creation link (`item.redone`) and reads
// what it finds as an item. The copy it leads to can be garbage-collected: an undo of a delete
// re-creates an object's map as the user's copy and keeps it, Yjs stops keeping it when a step
// that deleted inside it is cleared (`keepItem(item, false)` walks up to the map), and when
// another client then deletes the object the document collects the copy and every value in it.
// A later step that restores a value of the object's earlier map walks from the value along its
// key to the copy, finds a collected struct and throws a `TypeError`, after it has popped the
// step and possibly restored some of its other values. So the history asks first, reading the
// document as Yjs will, without writing to it, and uses the step up unapplied when Yjs would
// throw on it (`undo-manager.ts`).

/** What Yjs's `redoItem` does with a value. */
type Outcome = 'restores' | 'refuses' | 'throws';

/**
 * The copy Yjs makes of a value while applying the step, before it exists: a new last value of
 * its key, in the parent it is restored into.
 */
interface PlannedCopy {
  readonly parent: Y.Item | PlannedCopy | null;
}

/** A struct a re-creation link leads to that is no longer an item. */
const COLLECTED = Symbol('collected');

/** Where a walk stands: an item, a copy the step makes, or a collected struct. */
type Place = Y.Item | PlannedCopy | typeof COLLECTED;

/**
 * Replays, without writing, the part of Yjs's `popStackItem` that restores what a step deleted
 * (`redoItem` for each value, in Yjs's order), to tell whether it throws.
 */
class RestoreWalk {
  readonly #transaction: Y.Transaction;
  readonly #step: UndoStep;
  readonly #isOwnDeletion: (id: Y.ID) => boolean;
  readonly #toRestore: ReadonlySet<Y.Item>;
  /** The values restored so far in the walk, with their copies: Yjs sets their `redone`. */
  readonly #planned = new Map<Y.Item, PlannedCopy>();

  constructor(
    transaction: Y.Transaction,
    step: UndoStep,
    isOwnDeletion: (id: Y.ID) => boolean,
    toRestore: ReadonlySet<Y.Item>,
  ) {
    this.#transaction = transaction;
    this.#step = step;
    this.#isOwnDeletion = isOwnDeletion;
    this.#toRestore = toRestore;
  }

  /**
   * Whether Yjs throws on one of the values.
   *
   * @returns `true` when it would.
   */
  throws(): boolean {
    for (const item of this.#toRestore) {
      if (this.#outcome(item) === 'throws') return true;
    }
    return false;
  }

  /**
   * What `redoItem` does with a value: Yjs's order of reads, the parent first.
   *
   * @param item - A value the step deleted.
   * @returns Its outcome; a value it restores is noted as planned.
   */
  #outcome(item: Y.Item): Outcome {
    if (this.#hasCopy(item)) return 'restores';
    const parent = this.#parentOf(item);
    if (parent === 'refuses' || parent === 'throws') return parent;
    const outcome =
      item.parentSub === null ? this.#placeInList(item, parent) : this.#placeInMap(item);
    if (outcome !== 'restores') return outcome;
    // A copy whose map was collected has no type left to restore into.
    if (parent instanceof Y.Item && !(parent.content instanceof Y.ContentType)) return 'throws';
    this.#planned.set(item, { parent });
    return outcome;
  }

  /**
   * The parent Yjs restores a value into: its own parent, or that parent's last copy when the
   * parent was deleted (restored first when the step restores it too).
   *
   * @param item - The value.
   * @returns The parent, or why Yjs stops.
   */
  #parentOf(item: Y.Item): Y.Item | PlannedCopy | null | 'refuses' | 'throws' {
    const owner = (item.parent as Y.AbstractType<unknown>)._item;
    if (!owner?.deleted) return owner;
    if (!this.#hasCopy(owner)) {
      if (!this.#toRestore.has(owner)) return 'refuses';
      const outcome = this.#outcome(owner);
      if (outcome !== 'restores') return outcome;
    }
    let parent: Place = owner;
    while (parent instanceof Y.Item && this.#hasCopy(parent)) parent = this.#copyOf(parent);
    // A collected struct has no re-creation link for Yjs to read.
    return parent === COLLECTED ? 'throws' : parent;
  }

  /**
   * A map value: Yjs walks right along its key past later values the step or a stack removed,
   * or that were re-created (following each to its copy), and refuses when one is left.
   *
   * @param item - The value.
   * @returns Its outcome.
   */
  #placeInMap(item: Y.Item): Outcome {
    let left: Place = item;
    while (left instanceof Y.Item && left.right !== null && this.#isPassed(left.right)) {
      left = left.right;
      while (left instanceof Y.Item && this.#hasCopy(left)) left = this.#copyOf(left);
    }
    if (left === COLLECTED) return 'throws';
    return left instanceof Y.Item && left.right !== null ? 'refuses' : 'restores';
  }

  /**
   * A list value: Yjs looks left and right for a neighbour, or a copy of one, in the parent.
   *
   * @param item - The value.
   * @param parent - The parent it is restored into.
   * @returns Its outcome.
   */
  #placeInList(item: Y.Item, parent: Y.Item | PlannedCopy | null): Outcome {
    for (const side of ['left', 'right'] as const) {
      for (let next = side === 'left' ? item.left : item; next !== null; next = next[side]) {
        const found = this.#traceInto(next, parent);
        if (found === COLLECTED) return 'throws';
        if (found !== null) break;
      }
    }
    return 'restores';
  }

  /**
   * Follows a neighbour's copies until one lies in the parent.
   *
   * @param item - The neighbour.
   * @param parent - The parent.
   * @returns The copy in the parent, `null` when there is none, or a collected struct.
   */
  #traceInto(item: Y.Item, parent: Y.Item | PlannedCopy | null): Place | null {
    let trace: Place | null = item;
    while (trace !== null && trace !== COLLECTED && this.#ownerOf(trace) !== parent) {
      trace = trace instanceof Y.Item && this.#hasCopy(trace) ? this.#copyOf(trace) : null;
    }
    return trace;
  }

  /**
   * The parent item of an item or of a copy the step makes.
   *
   * @param place - The item or copy.
   * @returns Its parent item.
   */
  #ownerOf(place: Y.Item | PlannedCopy): Y.Item | PlannedCopy | null {
    return place instanceof Y.Item ? (place.parent as Y.AbstractType<unknown>)._item : place.parent;
  }

  /**
   * Whether Yjs walks past a later value of a key (its conflict rule).
   *
   * @param right - The later value.
   * @returns `true` when it was re-created, or removed by the step or by a step on a stack.
   */
  #isPassed(right: Y.Item): boolean {
    return (
      this.#hasCopy(right) ||
      Y.isDeleted(this.#step.insertions, right.id) ||
      this.#isOwnDeletion(right.id)
    );
  }

  /**
   * Whether an item was re-created, before the step or by it.
   *
   * @param item - The item.
   * @returns `true` when it has a copy.
   */
  #hasCopy(item: Y.Item): boolean {
    return item.redone !== null || this.#planned.has(item);
  }

  /**
   * An item's next copy, as Yjs reads it (`getItemCleanStart`).
   *
   * @param item - An item with a copy (`#hasCopy`).
   * @returns The copy, or a collected struct; the item itself when it has no copy.
   */
  #copyOf(item: Y.Item): Place {
    const planned = this.#planned.get(item);
    if (planned !== undefined) return planned;
    if (item.redone === null) return item;
    const copy = Y.getItemCleanStart(this.#transaction, item.redone);
    return copy instanceof Y.Item ? copy : COLLECTED;
  }
}

/**
 * Tells whether Yjs would throw while applying a step, because restoring one of its values
 * follows a re-creation link to a collected struct (see above). Reads the document as Yjs does,
 * and splits structs where Yjs would; writes nothing. Cost: one pass over the values the step
 * deleted, each walking its key's later values.
 *
 * @param transaction - The open transaction the step will be applied in.
 * @param step - The step Yjs is handed.
 * @param objects - The document's objects map (the history's scope).
 * @param isOwnDeletion - Whether a step Yjs sees on the stacks while applying this one deleted
 *   an item.
 * @returns `true` when applying the step would throw.
 */
export function reachesCollectedCopy(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
  isOwnDeletion: (id: Y.ID) => boolean,
): boolean {
  const toRestore = new Set<Y.Item>();
  Y.iterateDeletedStructs(transaction, step.deletions, (struct) => {
    if (!(struct instanceof Y.Item) || !Y.isParentOf(objects, struct)) return;
    if (!Y.isDeleted(step.insertions, struct.id)) toRestore.add(struct);
  });
  return new RestoreWalk(transaction, step, isOwnDeletion, toRestore).throws();
}
