import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

/**
 * What hit testing and marquee selection need from a spatial index: the candidates whose world
 * box meets a rectangle. `SceneSpatialIndex` and `RTree<ObjectId>` both provide it.
 */
export interface SpatialSearch {
  /**
   * Every indexed object whose world box meets a rectangle, edges included.
   *
   * @param rect - The query rectangle, world units.
   * @returns The ids, in no particular order.
   */
  searchRect(rect: WorldBounds): readonly ObjectId[];
}
