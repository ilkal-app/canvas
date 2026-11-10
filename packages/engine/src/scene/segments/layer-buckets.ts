import type { DrawListEntry } from '../draw-list.js';

import type { PlannedPass } from './segment-plan.js';
import { tableEntry } from './table-entry.js';

/** What {@link bucketsOf} reads of a layered plan's input. */
export interface BucketInput {
  /** The culler's visible records. */
  readonly visible: readonly DrawListEntry[];
  /** The passes, with their slot owners. */
  readonly passes: readonly PlannedPass[];
  /** The layer composite pass's name: its records are left out. */
  readonly compositePassName: string;
  /** Passes drawn on the canvas whatever layer their objects are in. */
  readonly outsidePassNames: ReadonlySet<string>;
}

/** One pass's (and page's) visible slots in one window. */
interface Run {
  readonly passName: string;
  readonly page: number | undefined;
  readonly ranges: { start: number; count: number }[];
}

/** Visible slots gathered per pass and page, for one plan. */
export type Bucket = Map<string, Run>;

/**
 * A window's run for a visible entry's pass and page, made on first use.
 *
 * @param buckets - Every window's bucket.
 * @param owner - The window: a layer's index, or −1 for the canvas.
 * @param key - The entry's pass and page.
 * @param entry - The visible entry.
 * @returns The run.
 */
function runOf(
  buckets: Map<number, Bucket>,
  owner: number,
  key: string,
  entry: DrawListEntry,
): Run {
  let bucket = buckets.get(owner);
  if (bucket === undefined) {
    bucket = new Map();
    buckets.set(owner, bucket);
  }
  let run = bucket.get(key);
  if (run === undefined) {
    run = { passName: entry.passName, page: entry.page, ranges: [] };
    bucket.set(key, run);
  }
  return run;
}

/**
 * Appends one slot to a run, extending its last range when consecutive.
 *
 * @param run - The run.
 * @param slot - The slot.
 */
function addSlot(run: Run, slot: number): void {
  const last = run.ranges.at(-1);
  if (last !== undefined && last.start + last.count === slot) last.count += 1;
  else run.ranges.push({ start: slot, count: 1 });
}

/**
 * A bucket as draw list entries.
 *
 * @param bucket - The bucket, or undefined for none.
 * @returns Its entries.
 */
export function entriesOf(bucket: Bucket | undefined): DrawListEntry[] {
  if (bucket === undefined) return [];
  // Runs are made afresh for each plan, so their ranges are the entries' own.
  return [...bucket.values()].map(({ passName, page, ranges }) =>
    page === undefined ? { passName, ranges } : { passName, page, ranges },
  );
}

/**
 * Sorts the visible records into the canvas's bucket (key −1) and each layer's: a record goes to
 * the innermost layer holding its rank, or the canvas for a pass drawn outside layers; records of
 * invisible objects go nowhere in any pass, frame names included, and composite records are
 * added later, for visible layers only.
 *
 * @param input - The plan's input.
 * @param ownerOfRank - Per rank, its innermost layer.
 * @param invisible - Per rank, 1 when invisible.
 * @returns The buckets by layer index.
 * @throws {RangeError} When a visible entry names no pass.
 */
export function bucketsOf(
  input: BucketInput,
  ownerOfRank: Int32Array,
  invisible: Uint8Array,
): Map<number, Bucket> {
  const buckets = new Map<number, Bucket>();
  const byName = new Map(input.passes.map((pass) => [pass.name, pass]));
  for (const entry of input.visible) {
    if (entry.passName === input.compositePassName) continue;
    const pass = byName.get(entry.passName);
    if (pass === undefined)
      throw new RangeError(`The draw list names no scene pass "${entry.passName}".`);
    const isOutside = input.outsidePassNames.has(entry.passName);
    const { rankOfSlot } = pass.owners;
    const key =
      entry.page === undefined ? entry.passName : `${entry.passName} ${String(entry.page)}`;
    // Consecutive slots mostly share an owner (an object's records, a layer's objects).
    let lastOwner = Number.NaN;
    let run: Run | undefined;
    for (const { start, count } of entry.ranges) {
      const end = Math.min(start + count, rankOfSlot.length);
      for (let slot = start; slot < end; slot += 1) {
        const rank = tableEntry(rankOfSlot, slot);
        if (rank < 0) continue;
        // Opacity 0 hides everything, frame names included (owner, review).
        if (invisible[rank] === 1) continue;
        const owner = isOutside ? -1 : tableEntry(ownerOfRank, rank);
        if (run === undefined || owner !== lastOwner) {
          run = runOf(buckets, owner, key, entry);
          lastOwner = owner;
        }
        addSlot(run, slot);
      }
    }
  }
  return buckets;
}
