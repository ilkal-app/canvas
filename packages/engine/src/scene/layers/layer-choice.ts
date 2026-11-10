// What a layer selection takes and chooses, apart from `layer-selection.ts`.
import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

import type { LayerExtent } from './layer-budget.js';

/** A layer the frame could composite: an object in layer form with content. */
export interface LayerCandidate {
  /** The layer's object. */
  readonly id: ObjectId;
  /** How many layers enclose it: 0 for an outermost one. */
  readonly depth: number;
  /** What its content covers, world units (`boundsOfLayer`). */
  readonly bounds: WorldBounds;
}

/** What a `LayerSelection` chose for a frame, and what changed since the last. */
export interface LayerChoice {
  /** Every layer drawn in the multiply form, whatever the reason. Live: the next choice moves it. */
  readonly fallbacks: ReadonlySet<ObjectId>;
  /**
   * Of them, those that fell back for the budget: still planned as layers, their windows drawn
   * in place of their composites (`LayerDraw.isInline`), so a budget decision that follows the
   * zoom costs no re-plan. Live.
   */
  readonly inline: ReadonlySet<ObjectId>;
  /** Of them, those the plan leaves out: small or past the limit. Live. */
  readonly excluded: ReadonlySet<ObjectId>;
  /** The layers that fell back this frame. */
  readonly added: readonly ObjectId[];
  /** The layers that composite again this frame (or are layers no more). */
  readonly removed: readonly ObjectId[];
  /** Whether {@link LayerChoice.excluded} changed, so the frame must plan again. */
  readonly isExcludedChanged: boolean;
  /** How many fell back for being under the small edge (with its band). */
  readonly small: number;
  /** How many fell back past the per-frame limit. */
  readonly limit: number;
  /** How many fell back to keep the layers inside their budget. */
  readonly budget: number;
}

/** How a `LayerSelection` bounds a frame's layers. */
export interface LayerSelectionOptions {
  /** The most layers composited per frame; default `LAYER_LIMIT`. */
  readonly limit?: number;
  /** The layers share of the device's budget, bytes: scratch, targets and uniforms. */
  readonly byteBudget: number;
  /** The tile edge (`layerTileEdge`). */
  readonly tile: number;
  /**
   * The backend's scratch bytes per texel (`layerScratchBytesPerTexel`): the scratch is charged
   * at the chosen targets' extent at this rate. Default the worst, 32.
   */
  readonly scratchBytesPerTexel?: number;
  /**
   * The bytes each layer's targets hold now (`LayerTargetPool.heldBytesByLayer`): a layer that
   * keeps a larger target than its tiles need costs what it keeps. Omitted, none.
   */
  readonly heldBytes?: () => ReadonlyMap<string, number>;
  /**
   * The extent each layer's targets hold now (`LayerTargetPool.heldExtentByLayer`), read after
   * `heldBytes`: the scratch must hold a larger target a layer keeps. Omitted, none.
   */
  readonly heldExtent?: () => ReadonlyMap<string, LayerExtent>;
}
