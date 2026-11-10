import type { DrawStageBackground } from './draw-stage-background.js';
import { NO_FRAME_TIMERS, type FrameTimerHook } from './frame-context.js';
import { GridBackground } from './grid-background.js';

/**
 * Captures supported background callbacks; replacement or custom timer hooks refuse preview.
 *
 * @param background - Installed background, if any.
 * @param timers - Optional custom frame hooks.
 * @returns A live callback-identity check, without changing rendering.
 */
export function capturePreviewBackground(
  background: DrawStageBackground | undefined,
  timers: FrameTimerHook | undefined,
): () => boolean {
  if (timers !== undefined && timers !== NO_FRAME_TIMERS) return () => false;
  if (background === undefined) return () => true;
  if (Object.getPrototypeOf(background) !== GridBackground.prototype) return () => false;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Captured for identity comparison only.
  const draw = GridBackground.prototype.draw;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Captured for identity comparison only.
  const prepare = GridBackground.prototype.prepare;
  return () => background.draw === draw && background.prepare === prepare;
}
