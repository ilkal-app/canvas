import type { ObjectId } from '@canvas/schema';

import type { Scene } from '../scene.js';

import { ranksOfPass } from './closing-ranks.js';
import type { PlannedPass } from './segment-plan.js';

/**
 * Maps every slot of every pass's instance buffer back to the object holding it, by paint rank,
 * so the segment planner can order visible records without asking the scene per record. Slots
 * no object holds (released ones), or held by an object outside the paint order, get rank −1.
 * O(records): each pass walks only the objects it draws (`Scene.slotEntriesOf`), so a pass that
 * draws few objects (the connector pass on a board of few connectors) costs what it
 * draws, not another walk of the whole board. Rebuilt only when the paint order changes; a frame
 * in which only existing objects' record counts changed patches the tables instead
 * (`SlotOwnerTable`).
 *
 * A pass drawn after its objects' descendants (`ScenePass.isDrawnAfterDescendants`)
 * gives its slots the object's closing rank instead.
 *
 * @param scene - The scene, after it applied this frame's changes.
 * @param rankById - Every mirrored object's paint rank, bottom first from 0.
 * @param closingRankById - Each object's closing rank, where it has one; default none.
 * @param passNames - Only these passes (those re-slotted); default every pass.
 * @returns Each pass with its table, in the scene's pass order.
 */
export function slotOwnersOf(
  scene: Scene,
  rankById: ReadonlyMap<ObjectId, number>,
  closingRankById: ReadonlyMap<ObjectId, number> = new Map(),
  passNames?: ReadonlySet<string>,
): PlannedPass[] {
  const passes = passNames ? scene.passes.filter(({ name }) => passNames.has(name)) : scene.passes;
  return passes.map(({ name, isDrawnAfterDescendants }) => {
    const recordCount = scene.instanceBufferOf(name).recordCount;
    const rankOfSlot = new Int32Array(recordCount).fill(-1);
    const recordOfSlot = new Int32Array(recordCount);
    const ranks = ranksOfPass({ isDrawnAfterDescendants }, rankById, closingRankById);
    for (const [id, slots] of scene.slotEntriesOf(name)) {
      const rank = ranks.get(id);
      if (rank === undefined) continue;
      slots.forEach((slot, record) => {
        rankOfSlot[slot] = rank;
        recordOfSlot[slot] = record;
      });
    }
    return { name, owners: { rankOfSlot, recordOfSlot } };
  });
}
