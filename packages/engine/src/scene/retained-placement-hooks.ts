import type { ConnectorRouting } from '../connectors/connector-routing.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import type { RetainedPlacementHooks } from './retained-scene-move.js';
import type { SceneCuller } from './scene-culler.js';
import type { Scene } from './scene.js';
import { layerSlotsOf } from './segments/layered-segments.js';

/**
 * What a renderer's retained move places root leaves through without change sets:
 * a spatial culler's moving set, and its routing and layers, which keep a session on change sets.
 *
 * @param culler - The renderer's culler; only a `SpatialCuller` keeps moving boxes.
 * @param routing - The renderer's connector routing.
 * @param scene - The renderer's scene.
 * @returns The hooks.
 */
export function placementHooksOf(
  culler: SceneCuller,
  routing: ConnectorRouting,
  scene: Scene,
): RetainedPlacementHooks {
  return {
    ...(culler instanceof SpatialCuller && { culler }),
    hasConnectorsOutside: (ids) => routing.hasConnectorsOutside(ids),
    hasLayerAmong: (ids) => {
      const layers = layerSlotsOf(scene);
      return layers.size > 0 && ids.some((id) => layers.has(id));
    },
  };
}
