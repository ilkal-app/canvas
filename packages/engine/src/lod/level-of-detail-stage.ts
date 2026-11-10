import type { WorldBounds } from '../camera/camera.js';
import type { FrameStage } from '../scene/frame-context.js';

import type { LodVisibilityInput } from './lod-visibility.js';

/** The level-of-detail stage's name; it runs right after `collectChanges`. */
export const LEVEL_OF_DETAIL_STAGE_NAME = 'levelOfDetail';

/**
 * The frame stage that brings the scene's level of detail (`Scene.levelOfDetail`) up to date
 * for the frame's camera: right after `collectChanges`, before the passes' own stages
 * rewrite records (the text pass's `textRefresh`, the image pass's `images`) and before the
 * upload, so an object whose form changes is rewritten and uploaded in the same frame. It
 * evaluates the objects the culler draws this frame and counts the frame's transitions in
 * `FrameStats.lodTransitions` and `lodThrashes`. `SceneRenderer` installs it.
 *
 * @param visibleIdsOf - The objects the frame draws for a viewport (`SpatialCuller.visibilityFor`,
 *   the same array while the set is unchanged), or `undefined` when every object is drawn.
 * @returns The stage.
 */
export function createLevelOfDetailStage(
  visibleIdsOf: (viewport: WorldBounds) => LodVisibilityInput,
): FrameStage {
  return {
    name: LEVEL_OF_DETAIL_STAGE_NAME,
    run({ camera, scene, stats, viewport }) {
      scene.levelOfDetail.update(visibleIdsOf(viewport), camera.zoom * camera.dpr, stats);
    },
  };
}
