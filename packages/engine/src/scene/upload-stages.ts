import type { ClipTableTexture } from './clip-table-texture.js';
import type { Frame } from './frame.js';
import type { RetainedSceneMove } from './retained-scene-move.js';

/**
 * Wraps a renderer's `uploadDirtyRanges` so a retained move's placements and the clip table's
 * dirty texels upload before the ranges. Moved out of `SceneRenderer` for its size.
 *
 * @param frame - The renderer's frame.
 * @param retainedMove - Its retained move.
 * @param clipTable - Its clip table.
 */
export function installUploadStages(
  frame: Frame,
  retainedMove: RetainedSceneMove,
  clipTable: ClipTableTexture,
): void {
  frame.wrapStage('uploadDirtyRanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      retainedMove.upload(context.stats);
      clipTable.flush(context.stats);
      inner.run(context);
    },
  }));
}
