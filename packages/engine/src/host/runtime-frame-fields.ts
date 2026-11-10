import type { SceneRenderer } from '../scene/scene-renderer.js';

import type { EngineCanvas } from './engine-host-platform.js';
import type { EngineFrameReport } from './engine-host.js';

/**
 * Captures the drawing buffer and drains this frame's bounded undrawable-object report.
 *
 * @param canvas - The buffer actually drawn, rather than the requested camera size.
 * @param renderer - The renderer whose pending report belongs to this frame.
 * @returns Drawing fields, omitting undrawable fields when no objects were refused.
 */
export function drawingFrameFields(
  canvas: EngineCanvas,
  renderer: SceneRenderer,
): Pick<EngineFrameReport, 'drawingBuffer' | 'undrawable' | 'undrawableCount'> {
  const undrawable = renderer.takeUndrawable();
  return {
    drawingBuffer: { widthPx: canvas.width, heightPx: canvas.height },
    ...(undrawable.count > 0 && {
      undrawable: undrawable.objects,
      undrawableCount: undrawable.count,
    }),
  };
}
