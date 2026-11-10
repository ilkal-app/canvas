import type { ObjectId } from '@canvas/schema';

import type { Scene } from '../scene.js';

import { ranksOfPass } from './closing-ranks.js';
import type { PlannedPass } from './segment-plan.js';
import { slotOwnersOf } from './slot-owners.js';

/** No slots: a noted object that held no records in a pass. */
const NO_SLOTS: readonly number[] = Object.freeze([]);

/**
 * A pass's table able to hold a record count: the same table, mutated in place by the caller,
 * when it is long enough (step 2: no per-keystroke copy of a 50k-entry table); else a
 * copy grown to the buffer's capacity, the grown slots unowned. A table longer than the record
 * count has an unowned tail, which every reader bounds by the table's length.
 *
 * @param owners - The pass's table.
 * @param recordCount - The pass's buffer's record count now.
 * @param capacity - The buffer's capacity, at least `recordCount`.
 * @returns The table to write into.
 */
function grown(
  owners: PlannedPass['owners'],
  recordCount: number,
  capacity: number,
): PlannedPass['owners'] {
  if (recordCount <= owners.rankOfSlot.length) return owners;
  const length = Math.max(recordCount, capacity);
  const rankOfSlot = new Int32Array(length).fill(-1);
  const recordOfSlot = new Int32Array(length);
  rankOfSlot.set(owners.rankOfSlot);
  recordOfSlot.set(owners.recordOfSlot);
  return { rankOfSlot, recordOfSlot };
}

/**
 * The z-order segments' slot-owner tables (`slotOwnersOf`), kept current at the cost of what
 * changed. A paint-order change rebuilds every pass's table; an existing object whose
 * record count alone changed (typing into a text) has only its slots rewritten: its old slots,
 * read from the scene before the change set reaches it (`noteChanged`), are released and its new
 * ones owned. Typing on a 50k-object board thus touches a few slots, not every pass's 50k-entry
 * table.
 */
export class SlotOwnerTable {
  /** Each pass's table, in the scene's pass order. */
  tables: readonly PlannedPass[] = [];
  /** How many times every table was rebuilt. */
  builds = 0;
  /** How many frames patched the tables instead. */
  patches = 0;
  /** The objects noted since the last build or patch, in the order first noted. */
  private readonly noted = new Set<ObjectId>();
  /**
   * The noted objects' slots as the tables last saw them, by pass name, then object: only where
   * an object held records, so a page switch's 10k objects cost no entry in the passes they do
   * not draw in.
   */
  private readonly oldSlots = new Map<string, Map<ObjectId, readonly number[]>>();

  /**
   * Notes objects whose record count is about to change, before the scene applies the change
   * set: their slots as the tables know them are read now, once per object until the next build
   * or patch.
   *
   * @param scene - The scene, not yet holding the change set.
   * @param ids - The objects whose record count changes.
   */
  noteChanged(scene: Scene, ids: Iterable<ObjectId>): void {
    for (const id of ids) {
      if (this.noted.has(id)) continue;
      this.noted.add(id);
      for (const { name } of scene.passes) {
        const slots = scene.slotsOf(id, name);
        if (slots.length === 0) continue;
        let held = this.oldSlots.get(name);
        if (held === undefined)
          this.oldSlots.set(name, (held = new Map<ObjectId, readonly number[]>()));
        held.set(id, [...slots]);
      }
    }
  }

  /**
   * Rebuilds every pass's table.
   *
   * @param scene - The scene, after it applied this frame's changes.
   * @param rankById - Every mirrored object's paint rank.
   * @param closingRankById - Each object's closing rank, where it has one.
   */
  rebuild(
    scene: Scene,
    rankById: ReadonlyMap<ObjectId, number>,
    closingRankById: ReadonlyMap<ObjectId, number>,
  ): void {
    this.tables = slotOwnersOf(scene, rankById, closingRankById);
    this.forgetNoted();
    this.builds += 1;
  }

  /**
   * Rebuilds the tables of some passes only, when only their records moved (the
   * compactor re-slotted them, `SlotCompactor`); the others stand.
   *
   * @param scene - The scene, after the re-slot.
   * @param passNames - The re-slotted passes.
   * @param rankById - Every mirrored object's paint rank.
   * @param closingRankById - Each object's closing rank, where it has one.
   */
  rebuildPasses(
    scene: Scene,
    passNames: ReadonlySet<string>,
    rankById: ReadonlyMap<ObjectId, number>,
    closingRankById: ReadonlyMap<ObjectId, number>,
  ): void {
    const rebuilt = new Map(
      slotOwnersOf(scene, rankById, closingRankById, passNames).map((pass) => [pass.name, pass]),
    );
    this.tables = this.tables.map((pass) => rebuilt.get(pass.name) ?? pass);
  }

  /**
   * Moves every owned slot's rank through an edit of the paint order, in place: a slot
   * whose rank the edit removed is unowned. The edited objects' own slots are then rewritten by
   * {@link SlotOwnerTable.patch} (the mirror notes them as changed).
   *
   * @param newRanks - Per old rank, its new rank, or -1 for a removed one (`RankShift.newRanks`).
   * @param firstMoved - The lowest rank the edit moved (`RankShift.firstMoved`): the slots of
   *   lower ranks (and unowned ones) are left as they are.
   */
  remap(newRanks: Int32Array, firstMoved = 0): void {
    for (const { owners } of this.tables) {
      const { rankOfSlot, recordOfSlot } = owners;
      for (let slot = 0; slot < rankOfSlot.length; slot += 1) {
        const rank = rankOfSlot[slot] ?? -1;
        if (rank < firstMoved) continue;
        const moved = newRanks[rank] ?? -1;
        rankOfSlot[slot] = moved;
        if (moved < 0) recordOfSlot[slot] = 0;
      }
    }
  }

  /**
   * Rewrites the slots of the objects noted since the last build or patch, in every pass, in
   * place (step 2): the same owners `slotOwnersOf` would build, when the paint order is
   * unchanged, in a table that may be longer (an unowned tail). Nothing keeps a table across a
   * patch (a slot change re-plans the segments and their windows).
   *
   * @param scene - The scene, after it applied this frame's changes.
   * @param rankById - Every mirrored object's paint rank.
   * @param closingRankById - Each object's closing rank, where it has one.
   */
  patch(
    scene: Scene,
    rankById: ReadonlyMap<ObjectId, number>,
    closingRankById: ReadonlyMap<ObjectId, number>,
  ): void {
    this.tables = scene.passes.map((pass, index) => {
      const previous = this.tables[index];
      if (previous === undefined) throw new RangeError(`No slot table for pass ${pass.name}.`);
      // Only the changed objects holding records in this pass, before or after; a pass with none
      // keeps its table untouched.
      const held = this.oldSlots.get(pass.name);
      const changed: [ObjectId, readonly number[]][] = [];
      for (const id of this.noted) {
        const slots = held?.get(id) ?? NO_SLOTS;
        if (slots.length > 0 || scene.slotsOf(id, pass.name).length > 0) changed.push([id, slots]);
      }
      if (changed.length === 0) return previous;
      const buffer = scene.instanceBufferOf(pass.name);
      const owners = grown(previous.owners, buffer.recordCount, buffer.capacity);
      // Every old slot is released before any new one is owned: a slot one changed object gave
      // up may be another's now.
      for (const [, slots] of changed) {
        for (const slot of slots) {
          if (slot >= owners.rankOfSlot.length) continue;
          owners.rankOfSlot[slot] = -1;
          owners.recordOfSlot[slot] = 0;
        }
      }
      const ranks = ranksOfPass(pass, rankById, closingRankById);
      for (const [id] of changed) {
        const rank = ranks.get(id);
        if (rank === undefined) continue;
        scene.slotsOf(id, pass.name).forEach((slot, record) => {
          owners.rankOfSlot[slot] = rank;
          owners.recordOfSlot[slot] = record;
        });
      }
      return owners === previous.owners ? previous : { name: pass.name, owners };
    });
    this.forgetNoted();
    this.patches += 1;
  }

  /** Forgets the noted objects and their slots: the tables now hold them. */
  private forgetNoted(): void {
    this.noted.clear();
    this.oldSlots.clear();
  }
}
