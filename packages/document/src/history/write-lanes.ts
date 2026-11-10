import type * as Y from 'yjs';

// Histories on one store write under one Yjs client id, so the undo guards,
// which tell another writer's work by client id (`written-by-others.ts`), took the writes of
// every caller sharing an agent connection (each passes its own history key) for the
// step's own. So every history records, per document, the clock ranges of the transactions it
// captures (its commands, and its own undo and redo transactions) on the document's client id,
// under its key: its write lane. An item of the document's own client ids counts as another
// writer's when its range lies in a lane other than the step's. Ranges no history captured (the
// reference repair, system writes, writes before any keyed history existed) belong to no lane
// and stay the step's own, as before.
//
// Unkeyed histories record nothing until a keyed history is made on the document: a keyed
// history's steps all begin after it was made, so the writes before it are in every one of its
// steps' causal past, and between unkeyed histories every lane is the same one. A document with
// no keyed history therefore keeps no table and pays one flag test per guarded item.

/** A history's write lane: its key, or `undefined` for an unkeyed history. */
export type WriteLane = string | undefined;

/** The ranges of one client id: sorted, disjoint, half-open `[start, end)` clock ranges. */
interface ClientRanges {
  readonly starts: number[];
  readonly ends: number[];
  readonly lanes: WriteLane[];
}

/**
 * The write lanes of one document: which history's lane each recorded clock range of the
 * document's own client ids lies in. Shared by every history on the document. Lookups are a
 * binary search over a client's ranges, and adjacent ranges of one lane merge, so the table
 * grows by one range each time the writing lane changes. Single-threaded.
 */
export class WriteLanes {
  readonly #byClient = new Map<number, ClientRanges>();
  #isKeyed = false;

  /**
   * Whether a keyed history was ever made on the document; until then nothing is recorded and
   * every item is in no lane.
   *
   * @returns `true` once one was.
   */
  get isKeyed(): boolean {
    return this.#isKeyed;
  }

  /**
   * Notes a history made on the document. A keyed one starts the recording.
   *
   * @param lane - The history's lane.
   */
  noteHistory(lane: WriteLane): void {
    if (lane !== undefined) this.#isKeyed = true;
  }

  /**
   * Records that a lane wrote a clock range of a client. Ignored while the document has no
   * keyed history, and for an empty range.
   *
   * @param client - The Yjs client id.
   * @param start - The first clock of the range.
   * @param end - The clock after the last.
   * @param lane - The writing history's lane.
   */
  record(client: number, start: number, end: number, lane: WriteLane): void {
    if (!this.#isKeyed || end <= start) return;
    let ranges = this.#byClient.get(client);
    if (ranges === undefined) {
      ranges = { starts: [], ends: [], lanes: [] };
      this.#byClient.set(client, ranges);
    }
    const { starts, ends, lanes } = ranges;
    const last = ends.length - 1;
    // A client's clock only grows, so a range almost always comes after the last one.
    if (last >= 0 && ends[last] === start && lanes[last] === lane) {
      ends[last] = end;
      return;
    }
    const at = firstEndingAfter(ends, start);
    starts.splice(at, 0, start);
    ends.splice(at, 0, end);
    lanes.splice(at, 0, lane);
  }

  /**
   * Tells whether any part of a clock range of a client was recorded under a lane other than
   * the given one. Unrecorded parts are in no lane and count for nothing. Cost: a binary search,
   * then one step per recorded range the range overlaps.
   *
   * @param client - The Yjs client id.
   * @param start - The first clock of the range.
   * @param end - The clock after the last.
   * @param lane - The lane that counts as one's own.
   * @returns `true` when another lane wrote some of it.
   */
  hasOtherLane(client: number, start: number, end: number, lane: WriteLane): boolean {
    const ranges = this.#byClient.get(client);
    if (ranges === undefined) return false;
    const { starts, ends, lanes } = ranges;
    for (let at = firstEndingAfter(ends, start); at < ends.length; at += 1) {
      if ((starts[at] ?? end) >= end) return false;
      if (lanes[at] !== lane) return true;
    }
    return false;
  }

  /**
   * The number of ranges recorded, over every client, for tests and benchmarks.
   *
   * @returns The count.
   */
  get size(): number {
    let size = 0;
    for (const { ends } of this.#byClient.values()) size += ends.length;
    return size;
  }
}

/**
 * The index of the first range whose end is after a clock, in a sorted array of ends.
 *
 * @param ends - The ranges' ends, ascending.
 * @param clock - The clock.
 * @returns The index, `ends.length` when there is none.
 */
function firstEndingAfter(ends: readonly number[], clock: number): number {
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((ends[middle] ?? 0) > clock) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Each document's lanes, shared by every history on it and released with the document. */
const LANES = new WeakMap<Y.Doc, WriteLanes>();

/**
 * The write lanes of a document, made on first use.
 *
 * @param doc - The document.
 * @returns Its lanes.
 */
export function writeLanesOf(doc: Y.Doc): WriteLanes {
  let lanes = LANES.get(doc);
  if (lanes === undefined) {
    lanes = new WriteLanes();
    LANES.set(doc, lanes);
  }
  return lanes;
}

/**
 * The write lanes of a document when they can tell anything apart: once a keyed history was
 * made on it. Allocates nothing.
 *
 * @param doc - The document.
 * @returns Its lanes, or `undefined` when every item is in no lane.
 */
export function keyedLanesOf(doc: Y.Doc): WriteLanes | undefined {
  const lanes = LANES.get(doc);
  return lanes?.isKeyed === true ? lanes : undefined;
}

/**
 * Records the clock range a captured transaction wrote on the document's client id under a
 * history's lane. Call it for each transaction the history records, its undo and redo
 * transactions included.
 *
 * @param transaction - The finished transaction; its `beforeState` and `afterState` are set.
 * @param lane - The history's lane.
 */
export function recordLane(transaction: Y.Transaction, lane: WriteLane): void {
  const { doc } = transaction;
  const lanes = keyedLanesOf(doc);
  if (lanes === undefined) return;
  const client = doc.clientID;
  const start = transaction.beforeState.get(client) ?? 0;
  lanes.record(client, start, transaction.afterState.get(client) ?? start, lane);
}
