import type { Rgba } from '@canvas/schema';

/**
 * A snapping guide: a line through the edge or
 * centre a dragged box snapped to, across the box and every object on that line. The overlay
 * draws it one CSS pixel wide at any zoom.
 */
export interface SnapGuide {
  /**
   * The axis whose coordinate snapped: `x` is a vertical line at `x = position`, `y` a
   * horizontal one at `y = position`.
   */
  readonly axis: 'x' | 'y';
  /** Where the line is on its axis, world units. */
  readonly position: number;
  /** Where the line starts along the other axis, world units. */
  readonly from: number;
  /** Where the line ends along the other axis, world units; at least `from`. */
  readonly to: number;
}

/**
 * The guides' red, in whole 8-bit steps, (242, 72, 34), so it reaches the canvas exactly and
 * pixel tests can find it.
 */
export const SNAP_GUIDE_COLOR: Rgba = [242 / 255, 72 / 255, 34 / 255, 1];
