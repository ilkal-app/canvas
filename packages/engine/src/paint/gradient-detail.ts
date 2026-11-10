import type { BoardObject } from '@canvas/schema';

import type { PassLevelOfDetail } from '../lod/level-of-detail.js';
import type { LodRule } from '../lod/lod-rule.js';

/**
 * A gradient-filled shape or frame background whose box's longer side is under this many device
 * pixels draws its paint's average colour (`paintAverageColor`): the stops
 * blur into one colour there anyway, and the fragment then reads no paint table. The image
 * rule's threshold, for the same reason.
 */
export const GRADIENT_AVERAGE_COLOR_EDGE_PX = 8;

/** Gradient fills: the box's longer side on screen; the average colour under 8 px. */
export const GRADIENT_LOD_RULE: LodRule = {
  kind: 'gradient',
  levels: [{ form: 'average-color', belowPx: GRADIENT_AVERAGE_COLOR_EDGE_PX }],
};

/**
 * The gradient shape and frame-background passes' level-of-detail rule ({@link GRADIENT_LOD_RULE}):
 * measured on the box's longer side, with the 20% band.
 */
export const GRADIENT_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: GRADIENT_LOD_RULE,
  sizeOf: (object: BoardObject) =>
    'width' in object && 'height' in object ? Math.max(object.width, object.height) : 0,
  isSameSize: (previous: BoardObject, next: BoardObject) =>
    'width' in previous &&
    'width' in next &&
    previous.width === next.width &&
    previous.height === next.height,
};
