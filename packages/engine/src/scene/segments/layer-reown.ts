import type { ObjectId } from '@canvas/schema';

import type { Bucket } from './layer-buckets.js';
import type { LayerStructure } from './layer-structure.js';
import type { PlannedPass } from './segment-plan.js';
import { holdsSlot } from './slot-ranges.js';
import { tableEntry } from './table-entry.js';

/** A window's key: its layer's id, or the empty string for the canvas. */
export type WindowKey = ObjectId | '';

/** The canvas's window key. */
export const CANVAS_WINDOW: WindowKey = '';

/** What {@link reownSlots} reads. */
export interface ReownInput {
  /** The passes, with their slot owners and page tables. */
  readonly passes: readonly PlannedPass[];
  /** The layer composite pass's name: its records are in no window's bucket. */
  readonly compositePassName: string;
  /** Passes drawn on the canvas whatever layer their objects are in. */
  readonly outsidePassNames: ReadonlySet<string>;
  /** Each rank's slots in a pass. */
  readonly slotsOfRank: (rank: number, passName: string) => readonly number[];
}

/** Moves one visible slot from one window to another. */
export type MoveSlot = (from: WindowKey, to: WindowKey, pass: PlannedPass, slot: number) => void;

/**
 * A window's key in a structure.
 *
 * @param structure - The structure.
 * @param index - A layer's index, or −1 for the canvas.
 * @returns The key.
 */
export function keyOf(structure: LayerStructure, index: number): WindowKey {
  return structure.layers[index]?.id ?? CANVAS_WINDOW;
}

/**
 * A slot's run key in a bucket: its pass, and its page for a paged pass (as the draw list splits
 * a paged pass, `splitRangesByPage`: past the table, page 0), as `bucketsOf` keys runs.
 *
 * @param pass - The pass.
 * @param slot - The slot.
 * @returns The run's key and page.
 */
export function runKeyOf(
  pass: PlannedPass,
  slot: number,
): { key: string; page: number | undefined } {
  const { pageOfSlot } = pass;
  if (pageOfSlot === undefined) return { key: pass.name, page: undefined };
  const page = pageOfSlot[slot] ?? 0;
  return { key: `${pass.name} ${String(page)}`, page };
}

/**
 * Moves the visible slots whose window changed between two structures of the same tables, which
 * differ only in which layers are planned: a layer no longer planned hands every
 * slot of its window to whichever window now holds its rank; a layer newly planned takes the
 * visible slots of the ranks it now holds from the windows that held them. Pure apart from the
 * reads and `move`, which may be called twice for one slot.
 *
 * @param input - The passes and their slots by rank.
 * @param before - The windows at the last plan.
 * @param after - The windows now.
 * @param buckets - Each window's visible slots at the last plan.
 * @param move - Called for each slot that changes window.
 */
export function reownSlots(
  input: ReownInput,
  before: LayerStructure,
  after: LayerStructure,
  buckets: ReadonlyMap<WindowKey, Bucket>,
  move: MoveSlot,
): void {
  const byName = new Map(input.passes.map((pass) => [pass.name, pass]));
  const planned = new Set(after.layers.map(({ id }) => id));
  for (const layer of before.layers) {
    if (planned.has(layer.id)) continue;
    for (const run of buckets.get(layer.id)?.values() ?? []) {
      const pass = byName.get(run.passName);
      if (pass === undefined) continue;
      for (const { start, count } of run.ranges) {
        for (let slot = start; slot < start + count; slot += 1) {
          const rank = tableEntry(pass.owners.rankOfSlot, slot);
          if (rank >= 0)
            move(layer.id, keyOf(after, tableEntry(after.ownerOfRank, rank)), pass, slot);
        }
      }
    }
  }
  const wasPlanned = new Set(before.layers.map(({ id }) => id));
  const passesOf = new Map<WindowKey, PlannedPass[]>();
  for (const layer of after.layers) {
    if (wasPlanned.has(layer.id)) continue;
    for (let rank = layer.open; rank <= layer.close; rank += 1) {
      if (tableEntry(after.ownerOfRank, rank) !== layer.index || after.invisible[rank] === 1)
        continue;
      const was = keyOf(before, tableEntry(before.ownerOfRank, rank));
      const bucket = buckets.get(was);
      if (bucket === undefined) continue;
      let passes = passesOf.get(was);
      if (passes === undefined) {
        const names = new Set([...bucket.values()].map(({ passName }) => passName));
        // Passes drawn outside layers stay on the canvas whichever layer holds their objects.
        passes = input.passes.filter(
          ({ name }) => names.has(name) && !input.outsidePassNames.has(name),
        );
        passesOf.set(was, passes);
      }
      for (const pass of passes) {
        for (const slot of input.slotsOfRank(rank, pass.name)) {
          if (tableEntry(pass.owners.rankOfSlot, slot) !== rank) continue;
          const run = bucket.get(runKeyOf(pass, slot).key);
          if (run !== undefined && holdsSlot(run.ranges, slot)) move(was, layer.id, pass, slot);
        }
      }
    }
  }
}
