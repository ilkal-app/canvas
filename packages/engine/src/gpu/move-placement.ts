import type { GpuBuffer } from './gpu-buffer.js';
import type { TransformTable } from './transform-table.js';
import type { GpuVertexBufferLayout } from './vertex-layout.js';

/** Extra instance attribute used only by retained placement pipeline variants. */
export const MOVE_INDEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'instance',
  attributes: [{ location: 7, format: 'float32' }],
};

/** Retained placement resources borrowed by a drawer for one move session. */
export interface MovePlacementBinding {
  /** Absolute float32 object placements; index zero selects ordinary instance fields. */
  readonly table: TransformTable;
  /** Per-record table indices in vertex slot 2. */
  readonly indices: GpuBuffer;
  /**
   * The same per-record indices on the CPU, for exact custom-drawer bounds checks and the batched
   * path strokes' record texels. Fixed while bound: changed indices need a new binding.
   */
  readonly indexData: Float32Array;
}
