import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';

import type { FrameContext } from './frame-context.js';

/**
 * What the `draw` stage paints under every object (`createDrawStage`'s `background`), such as
 * the dot grid (`GridBackground`): it writes what it needs before the
 * stage's render pass opens, since writes are refused inside a pass, then draws first in that
 * pass, right after the clear. Runs on the thread that owns the backend.
 */
export interface DrawStageBackground {
  /**
   * Uploads what this frame's background draws with, before the render pass opens; a frame
   * whose camera is unchanged should write nothing.
   *
   * @param context - The frame's context; add the writes to `context.stats`.
   */
  prepare(context: FrameContext): void;
  /**
   * Draws into the open render pass, before the draw list.
   *
   * @param renderPass - The `draw` stage's pass, just cleared.
   * @param context - The frame's context; add the draws to `context.stats`.
   */
  draw(renderPass: GpuRenderPass, context: FrameContext): void;
}
