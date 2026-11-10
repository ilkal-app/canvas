import type { ObjectId } from '@canvas/schema';

import type { Scene } from '../scene.js';

import { ranksByObject } from './closing-ranks.js';
import type { RankShift } from './order-edits.js';
import { EMPTY_ORDER, isEndHidden, refreshOrder, type OrderTables } from './paint-order-tables.js';
import { hiddenTablesOf, shiftedHiddenTables } from './planned-passes.js';
import { RankIndex } from './rank-index.js';
import type { PlannedPass } from './segment-plan.js';
import type { SlotOwnerTable } from './slot-owner-table.js';
import type { ZOrderMirror } from './z-order-mirror.js';

/**
 * The z-order segments' tables as they stand (`ZOrderSegments.tables`), for tests and
 * diagnostics: live views, never to be mutated.
 */
export interface ZOrderTables {
  /** Per paint rank, its object (an object with a closing rank appears at both). */
  readonly paintOrder: readonly ObjectId[];
  /** Per rank, 1 where it is a closing rank. */
  readonly isClosingRank: Uint8Array;
  /** Per rank, 1 for an occluder. */
  readonly isOccluderByRank: Uint8Array;
  /** Every object's own rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** The closing rank of each object that has one. */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  /** Per scene pass, the ranks the level of detail hides (1), or `undefined` when it hides none. */
  readonly hiddenByRank: readonly (Uint8Array | undefined)[];
  /**
   * Per scene pass, each slot's rank and record (`SlotOwnerTable`); a table may be longer than
   * the pass's records, its tail unowned (-1).
   */
  readonly slotOwners: readonly PlannedPass[];
}

/** What a refresh of the paint order did, for the stage's plan. */
export interface PaintOrderRefresh {
  /** Whether the order was walked again (every table indexed by rank rebuilt). */
  readonly isOrderDirty: boolean;
  /** Whether the hidden tables changed. */
  readonly isHiddenDirty: boolean;
}

/**
 * The z-order segments' tables indexed by paint rank (split them from the stage): the
 * order with its closing ranks and occluders (`refreshOrder`), each object's own and closing
 * rank (`RankIndex`, built when first read after a walk, then kept current through edits), and
 * per pass the ranks the level of detail hides. An edit at the end of the order or of
 * leaf objects anywhere in it carries every table through it, the slot owners included;
 * any other change walks the order again. CPU-only; the frame's thread.
 */
export class PaintOrderState {
  /** The paint order, its closing ranks and its occluders. */
  order: OrderTables = EMPTY_ORDER;
  /** Per pass, per paint rank, 1 where the level of detail hides the object; absent: none. */
  hiddenByRank: readonly (Uint8Array | undefined)[] = [];
  /** How many refreshes walked the order. */
  builds = 0;
  /** How many refreshes edited it in its middle. */
  edits = 0;
  private rankById: RankIndex | undefined;
  private closingRanks = new RankIndex(); // Built with `rankById`.
  /** The level of detail's hidden revision the hidden tables were built at. */
  private hiddenRevision = -1;

  /**
   * Each closing rank by its object, as built with {@link PaintOrderState.ranks}.
   *
   * @returns The index (empty before the first build).
   */
  get closingRankById(): RankIndex {
    return this.closingRanks;
  }

  /**
   * Each object's own paint rank (and, into {@link PaintOrderState.closingRankById}, each
   * closing rank), built once per walk of the order.
   *
   * @returns The ranks by object.
   */
  ranks(): RankIndex {
    if (this.rankById) return this.rankById;
    const { rankById, closingRankById } = ranksByObject(
      this.order.paintOrder,
      this.order.isClosingRank,
    );
    this.rankById = rankById;
    this.closingRanks = closingRankById;
    return rankById;
  }

  /**
   * Brings every table up to a frame's change sets (`refreshOrder`): an edited order moves the
   * rank indexes, the hidden tables and the slot owners' ranks through its shift (the edited
   * objects' own slots are patched afterwards, `SlotOwnerTable.patch`); a walked one leaves the
   * rank indexes to be built again and rebuilds the hidden tables.
   *
   * @param scene - The scene, after it applied the frame's change sets.
   * @param mirror - The mirror, having observed them.
   * @param slots - The slot-owner tables, remapped through an edit.
   * @returns What changed.
   */
  refresh(scene: Scene, mirror: ZOrderMirror, slots: SlotOwnerTable): PaintOrderRefresh {
    const kept = this.order.paintOrder.length - mirror.trimmedIds.length;
    const appended = [...mirror.appendedIds];
    // An edit in the middle of the order moves the rank indexes, so they must exist.
    if (mirror.editedIds.size > 0 && !mirror.isOrderDirty) this.ranks();
    const ranks = this.rankById && {
      rankById: this.rankById,
      closingRankById: this.closingRanks,
    };
    const { tables, change, shift } = refreshOrder(this.order, mirror, scene.passes, ranks);
    const isOrderDirty = change === 'rebuilt';
    this.order = tables;
    if (isOrderDirty) this.rankById = undefined;
    this.builds += isOrderDirty ? 1 : 0;
    this.edits += shift ? 1 : 0;
    const isHiddenStale = scene.levelOfDetail.hiddenRevision !== this.hiddenRevision;
    const isHiddenDirty =
      isOrderDirty ||
      isHiddenStale ||
      shift !== undefined ||
      (change === 'appended' && isEndHidden(scene, this.hiddenByRank, kept, appended));
    if (shift && !isHiddenStale) this.shiftHidden(scene, shift);
    else if (isHiddenDirty) this.rebuildHidden(scene);
    // Each slot's rank moves with the order; the edited objects' own slots are patched next.
    if (shift) slots.remap(shift.newRanks, shift.firstMoved);
    return { isOrderDirty, isHiddenDirty };
  }

  /**
   * Moves the hidden tables through an edit of the order (`shiftedHiddenTables`), or rebuilds
   * them when an inserted object is hidden in a pass that hid nothing.
   *
   * @param scene - The scene.
   * @param shift - Where the edit moved each rank.
   */
  private shiftHidden(scene: Scene, shift: RankShift): void {
    const shifted = shiftedHiddenTables(scene, this.hiddenByRank, shift);
    if (shifted) this.hiddenByRank = shifted;
    else this.rebuildHidden(scene);
  }

  /**
   * Rebuilds, per pass, which paint ranks the level of detail hides (`hiddenTablesOf`).
   *
   * @param scene - The scene.
   */
  private rebuildHidden(scene: Scene): void {
    this.hiddenRevision = scene.levelOfDetail.hiddenRevision;
    const ranks = { rankById: this.ranks(), closingRankById: this.closingRankById };
    this.hiddenByRank = hiddenTablesOf(scene, this.order.paintOrder.length, ranks);
  }
}
