import type { BoardObject } from '@canvas/schema';

import type { PassLevelOfDetail } from '../lod/level-of-detail.js';
import { CONNECTOR_LOD_RULE } from '../lod/lod-thresholds.js';

/**
 * The connector pass's level-of-detail rule, by its size on screen: a connector
 * whose stroke is under half a device pixel wide is hidden (`CONNECTOR_LOD_RULE`), with the 20%
 * band, so a zoom wobbling at the edge does not flicker. Its measure is the stroke's width, which a
 * re-route never changes: a connector moving with its targets is not measured again.
 */
export const CONNECTOR_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: CONNECTOR_LOD_RULE,
  sizeOf: (object: BoardObject): number => (object.type === 'connector' ? object.stroke.width : 0),
  isSameSize: (previous, next) =>
    previous.type === 'connector' &&
    next.type === 'connector' &&
    previous.stroke.width === next.stroke.width,
};
