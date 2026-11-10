import type { BrowserHostPlatform } from '@canvas/engine';

import { HarnessFrameScheduler } from './harness-frame-scheduler.js';

let scheduler: HarnessFrameScheduler | undefined;

/**
 * Keeps the main host's pending frames available for explicit frozen-clock harness reads.
 *
 * @param platform - The real browser platform; its ordinary RAF behavior is retained.
 * @returns The harness platform.
 */
export function harnessFramePlatform(platform: BrowserHostPlatform): BrowserHostPlatform {
  scheduler = new HarnessFrameScheduler(platform);
  const frames = scheduler;
  return {
    ...platform,
    requestAnimationFrame: (callback) => frames.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => {
      frames.cancelAnimationFrame(handle);
    },
  };
}

/**
 * Draws one pending main-host frame batch only for explicitly frozen scenario clocks.
 * The scenario determinism helper sets this marker before navigation. Real-time measurement
 * pages and production builds keep their normal animation-frame schedule.
 */
export function flushHarnessFrames(): void {
  if (import.meta.env.VITE_CANVAS_HARNESS !== '1') return;
  const clock = globalThis as typeof globalThis & { readonly isCanvasHarnessClockFrozen?: boolean };
  if (clock.isCanvasHarnessClockFrozen === true) scheduler?.flush();
}
