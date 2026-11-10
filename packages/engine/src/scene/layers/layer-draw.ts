import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

/**
 * One layer a frame draws: an object in layer form (`isLayerForm`) with visible
 * content, which the `layers` stage renders into its own target and the layer composite pass
 * draws once, at its opacity, into its parent layer's target or the canvas. The z-order segments
 * list them innermost first (`FrameContext.layers`), each with its window's draw list entries
 * tagged by its id (`DrawListEntry.layer`).
 */
export interface LayerDraw {
  /** The layer's object. */
  readonly id: ObjectId;
  /** Its record's slot in the layer composite pass, which the composite draw names. */
  readonly slot: number;
  /** The nearest enclosing layer it composites into, or undefined for the canvas. */
  readonly parent: ObjectId | undefined;
  /**
   * What its content covers, world units, as the spatial index clips it: the union of its
   * members' boxes (frame titles left out: they draw on the canvas).
   */
  readonly bounds: WorldBounds;
  /**
   * Whether it fell back to the multiply form for the budget this frame: it keeps
   * its place in the plan, but its window draws in place of its composite, into whichever pass
   * draws the composite, and no target is made for it.
   */
  readonly isInline?: boolean;
}
