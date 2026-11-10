import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import type { UpdateShape } from '../assets/update-scan.js';

// Atomic remote updates (, option d). Yjs applies an update's
// delete set at once but keeps back the structs it cannot integrate yet (an earlier update of
// their client has not arrived, or a neighbour or parent of another client's). A change of a
// field deletes its old value and inserts the new one, so a peer's update held back that way left
// the field with no value: the object could not be read (`missing-field`) and dropped out of the
// read, and an honest command on an object referring to it was refused (`missing-parent`,
// `missing-connector-target`) or measured in the wrong frame.
//
// So while the document holds structs it cannot integrate, a remote deletion of the current value
// of a key inside an object (a field of an object's map, of a label, …) is held back: that value
// stays until its replacement arrives, and Yjs then removes it itself (`Item.integrate` deletes
// a key's earlier value when the new one becomes current), or until nothing is pending any more,
// when what is still held is applied. Everything else applies at once, as before: deletions of
// whole objects (entries of a top-level map), of text, of network members (a key removed for
// good), and of anything not delivered yet, which Yjs keeps pending itself. Holding a deletion
// can only keep a value visible a little longer; an object reads as it was until the update that
// changes it has arrived whole. With nothing pending the update applies exactly as before.

/** Keys of an object map whose own keys are network members, which edits remove for good. */
const MEMBER_LISTS: ReadonlySet<string> = new Set(['vertices', 'segments']);

/** A deleted range: client, first clock, length. */
type Range = readonly [client: number, clock: number, length: number];

/**
 * Splits a v1 update at its delete set: the struct section ends where the delete set starts,
 * and an empty section of either kind is a single zero (a count of none).
 *
 * @param update - The update.
 * @param shape - Its shape (`readUpdateShape`).
 * @returns The structs with an empty delete set, and the delete set with no structs.
 */
export function splitUpdate(
  update: Uint8Array,
  shape: UpdateShape,
): { readonly structs: Uint8Array; readonly deletes: Uint8Array } {
  const start = shape.deleteSetStart;
  const structs = new Uint8Array(start + 1);
  structs.set(update.subarray(0, start));
  const deletes = new Uint8Array(update.length - start + 1);
  deletes.set(update.subarray(start), 1);
  return { structs, deletes };
}

/**
 * Reads the deleted ranges of a v1 update.
 *
 * @param deletes - The update.
 * @returns Its ranges.
 */
function rangesOf(deletes: Uint8Array): Range[] {
  const ranges: Range[] = [];
  for (const [client, items] of Y.decodeUpdate(deletes).ds.clients) {
    for (const { clock, len } of items) if (len > 0) ranges.push([client, clock, len]);
  }
  return ranges;
}

/**
 * Encodes deleted ranges as a v1 update with no structs.
 *
 * @param ranges - The ranges.
 * @returns The update.
 */
function encodeDeletes(ranges: readonly Range[]): Uint8Array {
  const byClient = new Map<number, Range[]>();
  for (const range of ranges) {
    const list = byClient.get(range[0]) ?? [];
    list.push(range);
    byClient.set(range[0], list);
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, byClient.size);
  for (const [client, list] of byClient) {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, list.length);
    for (const [, clock, length] of list) {
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarUint(encoder, length);
    }
  }
  return encoding.toUint8Array(encoder);
}

/**
 * Tells whether deleting a struct now could leave a key inside an object with no value: it is
 * the current value of a key of a nested map that is not a list of network members.
 *
 * @param struct - The struct.
 * @returns `true` when its deletion is held.
 */
function isHeldValue(struct: Y.Item | Y.GC): boolean {
  if (!(struct instanceof Y.Item) || struct.deleted || struct.parentSub === null) return false;
  // An integrated item's parent is always a shared type.
  const parent = struct.parent as Y.AbstractType<unknown>;
  const owner = parent._item;
  if (owner === null || (owner.parentSub !== null && MEMBER_LISTS.has(owner.parentSub))) {
    return false;
  }
  return parent._map.get(struct.parentSub) === struct;
}

/**
 * Sorts the integrated part of a deleted range, struct by struct.
 *
 * @param doc - The document.
 * @param range - The range, cut to the clocks the document holds.
 * @param now - Where the parts to apply now go.
 * @param held - Where the parts to hold go.
 */
function sortIntegrated(doc: Y.Doc, range: Range, now: Range[], held: Range[]): void {
  const [client, clock, length] = range;
  const end = clock + length;
  for (let at = clock; at < end;) {
    // Typed as an item, but a collected range is a `GC`, which `isHeldValue` tells apart.
    const struct: Y.Item | Y.GC = Y.getItem(doc.store, Y.createID(client, at));
    const next = Math.min(end, struct.id.clock + struct.length);
    (isHeldValue(struct) ? held : now).push([client, at, next - at]);
    at = next;
  }
}

/**
 * Sorts deleted ranges into those to apply now and those to hold. A part the document does not
 * hold yet applies now: Yjs keeps it pending until what it deletes arrives.
 *
 * @param doc - The document.
 * @param ranges - The ranges.
 * @returns The two lists.
 */
function sortRanges(
  doc: Y.Doc,
  ranges: readonly Range[],
): { readonly now: Range[]; readonly held: Range[] } {
  const now: Range[] = [];
  const held: Range[] = [];
  for (const [client, clock, length] of ranges) {
    const end = clock + length;
    const stop = Math.min(end, Y.getState(doc.store, client));
    if (clock < stop) {
      sortIntegrated(doc, [client, clock, stop - clock], now, held);
    }
    if (Math.max(clock, stop) < end) {
      const from = Math.max(clock, stop);
      now.push([client, from, end - from]);
    }
  }
  return { now, held };
}

/** Remote deletions held back while the document waits for structs (see above). */
export class HeldDeletes {
  #held: Range[] = [];

  /**
   * Applies a remote update's deletions, inside the transaction that applied its structs, and
   * releases what is held and may now apply. With nothing pending and nothing held, the delete
   * set is applied as it came.
   *
   * A deletion newly held makes no change to the document, so Yjs reports no update for it: the
   * caller hands the returned bytes to the update listeners itself, so a device cache logs them
   * (and a store replaying its log holds them again) as it logs every applied update (
   * fix round 1).
   *
   * @param doc - The document.
   * @param deletes - The update's delete set, as an update with no structs; `undefined` when it
   *   deletes nothing.
   * @param origin - The transaction's origin.
   * @returns The deletions of this update now held, as an update with no structs; `undefined`
   *   when none is.
   */
  apply(doc: Y.Doc, deletes: Uint8Array | undefined, origin: unknown): Uint8Array | undefined {
    if (doc.store.pendingStructs === null) {
      if (deletes !== undefined) Y.applyUpdate(doc, deletes, origin);
      if (this.#held.length > 0) {
        const held = this.#held;
        this.#held = [];
        Y.applyUpdate(doc, encodeDeletes(held), origin);
      }
      return undefined;
    }
    const earlier = sortRanges(doc, this.#held);
    const received = sortRanges(doc, deletes === undefined ? [] : rangesOf(deletes));
    this.#held = [...earlier.held, ...received.held];
    const now = [...earlier.now, ...received.now];
    if (now.length > 0) Y.applyUpdate(doc, encodeDeletes(now), origin);
    return received.held.length > 0 ? encodeDeletes(received.held) : undefined;
  }

  /**
   * Adds the held deletions to an encoded state, so a cache or a peer given the state keeps them
   * as it keeps Yjs's own pending ones (a store applying it holds them again while it waits).
   *
   * @param state - A v1 update encoding the document.
   * @returns The state with the held deletions merged in, or the same bytes when none is held.
   */
  withHeld(state: Uint8Array): Uint8Array {
    if (this.#held.length === 0) return state;
    return Y.mergeUpdates([state, encodeDeletes(this.#held)]);
  }
}
