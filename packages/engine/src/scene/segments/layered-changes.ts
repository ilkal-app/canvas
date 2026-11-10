import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

import { checkMovedObjects, type SegmentSpatialIndex } from './segment-moves.js';
import type { SegmentPlan } from './segment-plan.js';
import { tableEntry } from './table-entry.js';

/**
 * The most canvas objects that moved in a frame checked against the canvas's kept plan; past
 * it, the canvas plans again.
 */
export const MAX_CANVAS_CHECKED_MOVES = 256;

/** What changed since a layered plan, by rank. */
export interface LayeredChangeInput {
  /** Per paint rank, its object. */
  readonly paintOrder: readonly ObjectId[];
  /** Every object's own rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** Each closing rank by its object. */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  /** The objects that changed since the last plan (moved, resized, restyled). */
  readonly moved?: Iterable<ObjectId>;
  /** The ranks whose level-of-detail form changed in some pass. */
  readonly hiddenRanks?: Iterable<number>;
}

/** Which windows a layered plan must plan again. */
export interface WindowChanges {
  /** Windows that must plan again: layers by index, −1 for the canvas. */
  readonly dirty: Set<number>;
  /** Objects drawn on the canvas (not in any planned layer) that changed. */
  readonly canvasMoved: ObjectId[];
}

/**
 * Which windows changed: a rank whose form changed dirties the window holding it;
 * an object that changed dirties the windows holding any rank of its span (its own to its
 * closing one: a container's members changed with it), except that objects drawn on the canvas
 * are listed for {@link isCanvasPlanKept} instead. Pure.
 *
 * @param input - The ranks and what changed.
 * @param ownerOfRank - Per rank, the innermost planned layer holding it (−1: the canvas).
 * @returns The dirty windows and the canvas's changed objects.
 */
export function windowChangesOf(input: LayeredChangeInput, ownerOfRank: Int32Array): WindowChanges {
  const dirty = new Set<number>();
  const canvasMoved: ObjectId[] = [];
  for (const rank of input.hiddenRanks ?? []) dirty.add(tableEntry(ownerOfRank, rank));
  for (const id of input.moved ?? []) {
    const open = input.rankById.get(id);
    if (open === undefined) continue;
    const close = input.closingRankById.get(id) ?? open;
    for (let rank = open; rank <= close; rank += 1) {
      const owner = tableEntry(ownerOfRank, rank);
      const member = input.paintOrder[rank];
      if (owner >= 0) dirty.add(owner);
      else if (member !== undefined) canvasMoved.push(member);
    }
  }
  return { dirty, canvasMoved };
}

/** An object's ranks as the canvas plan sees them. */
export interface CanvasRanks {
  /** An object's own rank as the canvas plan sees it (a layer member: its composite's). */
  readonly rankOf: (id: ObjectId) => number | undefined;
  /** Likewise its closing rank (a layer member: none). */
  readonly closingRankOf: (id: ObjectId) => number | undefined;
}

/**
 * Each object's ranks as the canvas plan sees them: a canvas object's own; a layer member's, its
 * outermost planned layer's composite (closing) rank, with no closing rank of its own. Pure.
 *
 * @param input - The rank tables.
 * @param layers - The layers, innermost first, with their parents' indices and closing ranks.
 * @param ownerOfRank - Per rank, its innermost layer.
 * @returns The lookups.
 */
export function canvasRanksOf(
  input: Pick<LayeredChangeInput, 'rankById' | 'closingRankById'>,
  layers: readonly { readonly parent: number; readonly close: number }[],
  ownerOfRank: Int32Array,
): CanvasRanks {
  // A parent closes after its children, so it comes later: outermost ancestors read back to front.
  const outermost = new Int32Array(layers.length);
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const parent = layers[index]?.parent ?? -1;
    outermost[index] = parent < 0 ? index : tableEntry(outermost, parent);
  }
  const ownerOf = (id: ObjectId): number => {
    const rank = input.rankById.get(id);
    return rank === undefined ? -1 : tableEntry(ownerOfRank, rank);
  };
  return {
    rankOf: (id) => {
      const owner = ownerOf(id);
      return owner < 0 ? input.rankById.get(id) : layers[tableEntry(outermost, owner)]?.close;
    },
    closingRankOf: (id) => (ownerOf(id) < 0 ? input.closingRankById.get(id) : undefined),
  };
}

/** What {@link isCanvasPlanKept} checks a kept canvas plan against. */
export interface CanvasCheck extends CanvasRanks {
  /** The canvas's kept plan. */
  readonly plan: SegmentPlan;
  /** The canvas objects that changed. */
  readonly moved: readonly ObjectId[];
  /** The bounds of the composites the canvas draws. */
  readonly composites: readonly WorldBounds[];
  /** The spatial index, holding the new boxes. */
  readonly spatial: SegmentSpatialIndex;
}

/**
 * Whether the canvas's last plan still draws right after some canvas objects changed (
 * C2c), as an unlayered plan is checked (`checkMovedObjects`): no changed object meets, at its
 * new box, an object its plan's merges relied on not meeting, members of layers counting as
 * their composites; and none meets a composite's bounds, which the plan merged by. Pure apart
 * from the reads.
 *
 * @param check - The plan, what changed and how to look it up.
 * @returns True when the plan holds.
 */
export function isCanvasPlanKept(check: CanvasCheck): boolean {
  const { plan, moved, spatial } = check;
  if (!plan.hasSpatialMerges) return true;
  for (const id of moved) {
    const box = spatial.boundsOf(id);
    if (box === undefined) continue; // `checkMovedObjects` judges one without a box.
    const isMeeting = check.composites.some(
      (bounds) =>
        bounds.minX <= box.maxX &&
        box.minX <= bounds.maxX &&
        bounds.minY <= box.maxY &&
        box.minY <= bounds.maxY,
    );
    if (isMeeting) return false;
  }
  const verdict = checkMovedObjects(
    plan,
    moved,
    check.rankOf,
    spatial,
    MAX_CANVAS_CHECKED_MOVES,
    check.closingRankOf,
  );
  return verdict === 'kept';
}
