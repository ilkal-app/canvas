import type { FreehandTool, Stroke } from '@canvas/schema';

/**
 * The style the draw tool gives a new stroke: its sub-tool's look (pencil, marker or
 * highlighter), the stroke's colour and its width at full pressure, and the layer opacity (the
 * highlighter's translucency) when set. With `isEraser`, the eraser sub-tool is in use:
 * a drag erases strokes instead, and the look is the one drawing returns to.
 */
export interface DrawStyle {
  /** The sub-tool: pencil and highlighter draw at a constant width, the marker with pressure. */
  readonly tool: FreehandTool;
  /** The colour, a tuple or `ink`, and the width at full pressure, world px. */
  readonly stroke: Stroke;
  /** The layer's opacity from 0 to 1; opaque when absent. */
  readonly opacity?: number;
  /** Whether the eraser is the sub-tool in use: a drag erases whole strokes; drawing if absent. */
  readonly isEraser?: boolean;
}
