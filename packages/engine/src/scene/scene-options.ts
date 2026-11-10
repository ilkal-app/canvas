import type { LevelOfDetail } from '../lod/level-of-detail.js';

import type { ColorTargetsOptions } from './color-targets.js';
import type { InstanceBufferOptions } from './instance-buffer.js';

/** Options for a `Scene`: its colour resolution (theme, ink, tokens, fallback hook) too. */
export interface SceneOptions extends ColorTargetsOptions {
  /** Capacity and range coalescing of every pass's instance buffer. */
  readonly instanceBuffer?: InstanceBufferOptions;
  /**
   * The level-of-detail state to keep in step with the objects each pass draws; the renderer
   * shares its own with the passes it builds (`ScenePassEnvironment.levelOfDetail`). Default: a
   * new one.
   */
  readonly levelOfDetail?: LevelOfDetail;
  /**
   * Whether objects in layer form (`isLayerForm`) are drawn through offscreen layers that
   * composite their own opacity: then each record's opacity is relative to its
   * nearest layer. The renderer sets it only when it has both the layer composite pass and the
   * z-order segments that plan layers. Default false: every opacity multiplies (C1's form).
   */
  readonly isLayerFormDrawn?: boolean;
}
