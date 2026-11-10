import { findScannedItem } from './scanned-item-lookup.js';
import { NO_CLIENT, type ScannedItem, type UpdateScan } from './update-scan.js';

// Where a scanned item sits. Yjs writes an item's parent and key only when the item was
// inserted with neither neighbour; any other item takes them from its left neighbour at
// insertion (its origin), or, with none, from its right one (Yjs `Item.getMissing`). So a map
// value that replaced another inherits the replaced one's key, and a list's items inherit their
// first item's parent: the chain of neighbours leads to the item that carries them. A reader
// that places every item of an update (`listAssetIds`) would walk each chain once per item,
// which the review measured quadratic (8,000 items took 5 s on the relay's message
// path); every item's chain end is remembered here, so each is followed once. The relay's stamp
// check does not use it: it replays Yjs's integration instead (`meta/update-integration.ts`),
// which also weighs the right neighbour and what the document already holds.

/** An item that carries its parent and key: where the chain of neighbours ends in the update. */
export interface ChainRoot {
  /** The chain ends on an item of the update. */
  readonly kind: 'root';
  /** That item: its `parentName`, `parentClient`, `parentClock` and `parentSub` are written. */
  readonly root: ScannedItem;
}

/** A chain that leaves the update: the neighbour it names is not a scanned item. */
export interface ChainExit {
  /** The chain continues outside the update (the document, or nowhere). */
  readonly kind: 'exit';
  /** The neighbour's client. */
  readonly client: number;
  /** A clock inside the neighbour. */
  readonly clock: number;
}

/** A chain that cannot be followed: it loops (a malformed update), or the work ceiling hit. */
export interface ChainUnresolved {
  /** The chain has no end this reader can name. */
  readonly kind: 'unresolved';
}

/** Where an item's chain of neighbours ends. */
export type ChainEnd = ChainRoot | ChainExit | ChainUnresolved;

/** The one unresolved end; also marks an item whose chain is being followed (a loop). */
const UNRESOLVED: ChainUnresolved = Object.freeze({ kind: 'unresolved' });

/**
 * The neighbour an item takes its parent and key from: its origin, else its right origin.
 *
 * @param item - The item.
 * @returns The neighbour's id, or undefined when the item carries its parent itself.
 */
function neighbourOf(item: ScannedItem): { client: number; clock: number } | undefined {
  if (item.originClient !== NO_CLIENT)
    return { client: item.originClient, clock: item.originClock };
  if (item.rightOriginClient !== NO_CLIENT) {
    return { client: item.rightOriginClient, clock: item.rightOriginClock };
  }
  return undefined;
}

/**
 * The chain ends of one scanned update's items, each followed once and remembered, so placing
 * every item costs one step per item in all. A chain that loops ends unresolved. With a work
 * ceiling, the steps are counted across every item, and past the ceiling every chain not yet
 * followed ends unresolved and {@link ScannedPlacements.isExhausted} turns true.
 */
export class ScannedPlacements {
  readonly #scan: UpdateScan;
  readonly #maxSteps: number;
  readonly #ends = new Map<ScannedItem, ChainEnd>();
  #steps = 0;

  /**
   * Places the items of one scanned update.
   *
   * @param scan - The scanned update.
   * @param maxSteps - How many neighbours may be followed in all; unbounded by default.
   */
  constructor(scan: UpdateScan, maxSteps = Number.POSITIVE_INFINITY) {
    this.#scan = scan;
    this.#maxSteps = maxSteps;
  }

  /**
   * Whether the work ceiling was hit: some chains then ended unresolved without being followed.
   *
   * @returns True once more neighbours were asked for than the ceiling allows.
   */
  get isExhausted(): boolean {
    return this.#steps > this.#maxSteps;
  }

  /**
   * Finds where an item's chain of neighbours ends, following it only as far as a chain already
   * followed.
   *
   * @param item - One of the scan's items.
   * @returns The chain's end.
   */
  endOf(item: ScannedItem): ChainEnd {
    const known = this.#ends.get(item);
    if (known !== undefined) return known;
    const path: ScannedItem[] = [];
    let end: ChainEnd | undefined;
    let current = item;
    while (end === undefined) {
      const reached = this.#ends.get(current);
      if (reached !== undefined) {
        end = reached;
        break;
      }
      this.#steps += 1;
      if (this.#steps > this.#maxSteps) {
        end = UNRESOLVED;
        break;
      }
      // Marked while followed: meeting it again on this walk is a loop.
      this.#ends.set(current, UNRESOLVED);
      path.push(current);
      const neighbour = neighbourOf(current);
      if (neighbour === undefined) {
        end = { kind: 'root', root: current };
        break;
      }
      const next = findScannedItem(this.#scan, neighbour.client, neighbour.clock);
      if (next === undefined) end = { kind: 'exit', ...neighbour };
      else current = next;
    }
    for (const visited of path) this.#ends.set(visited, end);
    return end;
  }
}
