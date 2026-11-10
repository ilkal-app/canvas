import type { ObjectId } from '@canvas/schema';

import type { InstanceRange } from './scene-culler.js';

/**
 * One step of a frame's draw order: draw these instance ranges of one pass. The `draw` stage
 * walks the frame's draw list in order, so the list, not the pass order, decides what is drawn
 * over what. By default `cull` makes one entry per pass, in pass order; a z-order segment stage
 * inserted after `cull` rewrites it segment-major (segment 1 of every pass, then
 * segment 2, …), which bounds draw calls by passes × atlas pages × opaque segments. A paged
 * pass gets one entry per page it draws, pages ascending.
 */
export interface DrawListEntry {
  /** The pass to draw with; must name one of the scene's passes. */
  readonly passName: string;
  /**
   * The page every record of the entry samples, for a paged pass (`ScenePass.pageOf`): the
   * draw binds that page's bind group. Absent for a pass that is not paged.
   */
  readonly page?: number;
  /** The records to draw, one instanced draw per non-empty range, in order. */
  readonly ranges: readonly InstanceRange[];
  /**
   * The layer whose target the entry draws into (`LayerDraw`), for the `layers`
   * stage; absent for the canvas, which the `draw` stage draws. Layer entries come first in the
   * list, innermost layer first, so every pass sees the frame's whole draw order.
   */
  readonly layer?: ObjectId;
}
