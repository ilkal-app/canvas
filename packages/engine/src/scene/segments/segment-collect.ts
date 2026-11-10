// The z-order segments' hook on `collectChanges`: every change set
// reaches the mirror and the slot-owner table before the scene applies it, a large load is
// handed to the scene in paint order, and a still frame re-slots one chunk of a fragmented pass.
import type { ObjectId } from '@canvas/schema';

import type { Frame } from '../frame.js';
import type { Scene } from '../scene.js';

import { paintRanksOfSiblings } from './paint-order.js';
import { inPaintOrder, PAINT_ORDER_BATCH, type SlotCompactor } from './slot-compactor.js';
import type { SlotOwnerTable } from './slot-owner-table.js';
import type { ZOrderMirror } from './z-order-mirror.js';

/** What the hook feeds. */
export interface SegmentCollectTargets {
  /** The stage's mirror of the document. */
  readonly mirror: ZOrderMirror;
  /** The stage's slot-owner table. */
  readonly slots: SlotOwnerTable;
  /** The stage's slot compactor. */
  readonly compactor: SlotCompactor;
}

/**
 * Wraps a frame's `collectChanges` stage for the z-order segments, and registers their pending
 * compaction with the frame (`Frame.addPendingWork`).
 *
 * @param frame - The frame.
 * @param targets - The stage's mirror, slot owners and compactor.
 * @throws {RangeError} When the frame has no `collectChanges` stage.
 */
export function wrapSegmentCollect(frame: Frame, targets: SegmentCollectTargets): void {
  const { mirror, slots, compactor } = targets;
  frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      // Peek at the coalesced change set, then hand it back for the stage to apply.
      const changes = context.changes.drain();
      const { scene } = context;
      if (changes) {
        mirror.observe(changes, scene.passes);
        slots.noteChanged(scene, mirror.slotChangedIds);
        // A large load takes its slots in paint order. It takes the lowest free slots
        // first, not the most recently released: a page switch's later slices fill the slots of
        // the page it left, released in that page's paint order, and reused last first they put
        // the new page in reverse, one range per object and a whole re-slot.
        if (changes.created.length >= PAINT_ORDER_BATCH)
          for (const { name } of scene.passes) scene.instanceBufferOf(name).reuseLowestFirst();
        context.changes.push(inPaintOrder(changes, () => mirrorRanks(mirror, scene)));
      }
      compactor.beforeFrame(scene, context.camera, !!changes);
      inner.run(context);
    },
  }));
  frame.addPendingWork(() => compactor.hasPending());
}

/**
 * Each object's first paint rank from the mirror as it stands.
 *
 * @param mirror - The mirror, having observed the frame's change set.
 * @param scene - The scene, for its passes.
 * @returns The ranks.
 */
function mirrorRanks(mirror: ZOrderMirror, scene: Scene): Map<ObjectId, number> {
  const ranks = paintRanksOfSiblings(mirror.siblings, (id) => {
    const object = mirror.get(id);
    return object !== undefined && mirror.hasClosingRank(object, scene.passes);
  });
  const rankById = new Map<ObjectId, number>();
  ranks.ids.forEach((id, rank) => {
    if (!rankById.has(id)) rankById.set(id, rank);
  });
  return rankById;
}
