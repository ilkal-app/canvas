/**
 * Frames per second for the developer overlay: pure logic over a
 * rolling window of frame timestamps, since the engine draws only when something changed
 * (frames are on demand) rather than on a fixed clock. No `requestAnimationFrame` loop of its
 * own: the timestamps come from the engine's own frame reports (`EngineFrameReport.frameTimeMs`,
 * the page's clock, wherever the engine runs), which the shell already receives per frame.
 */

/** How long a rolling window of frame timestamps is kept, ms: enough for the 5-second low. */
export const FRAME_RATE_WINDOW_MS = 5_000;

/** The window the current figure counts frames over, ms. */
const CURRENT_WINDOW_MS = 1_000;

/** The width of one bucket of the low figure, ms: one second, so it reads as a frame rate. */
const LOW_BUCKET_MS = 1_000;

/** Current and lowest frame rate, or `'idle'` where nothing was drawn to measure it. */
export interface FrameRateReading {
  /** Frames drawn in the last second; `'idle'` when none were. */
  readonly currentFps: number | 'idle';
  /**
   * The fewest frames drawn in any one-second bucket of the last {@link FRAME_RATE_WINDOW_MS}
   * that had a frame at all (a bucket with none is a quiet board, not a stutter, and is left
   * out); `'idle'` when nothing was drawn in the whole window.
   */
  readonly lowFps: number | 'idle';
}

/**
 * Counts frame timestamps in a half-open window `(sinceMs, untilMs]`, so a timestamp is never
 * counted in two adjacent windows.
 *
 * @param frameTimesMs - The timestamps, any order.
 * @param sinceMs - The window's exclusive start.
 * @param untilMs - The window's inclusive end.
 * @returns How many fall inside it.
 */
function countBetween(frameTimesMs: readonly number[], sinceMs: number, untilMs: number): number {
  let count = 0;
  for (const timeMs of frameTimesMs) {
    if (timeMs > sinceMs && timeMs <= untilMs) count += 1;
  }
  return count;
}

/**
 * The current and lowest frame rate from a rolling window of frame timestamps. Pure: takes the
 * window and the current time explicitly, so it needs no clock of its own and is exactly
 * reproducible in a test.
 *
 * @param frameTimesMs - Frame timestamps within the last {@link FRAME_RATE_WINDOW_MS} (ms, the
 *   same clock as `nowMs`); `recordFrameTime` keeps a caller's array this way. Older timestamps
 *   are ignored, so a caller may pass a longer history safely.
 * @param nowMs - The current time, the same clock as `frameTimesMs`.
 * @returns The reading.
 */
export function frameRateOf(frameTimesMs: readonly number[], nowMs: number): FrameRateReading {
  const windowStartMs = nowMs - FRAME_RATE_WINDOW_MS;
  const current = countBetween(frameTimesMs, nowMs - CURRENT_WINDOW_MS, nowMs);
  let low: number | undefined;
  for (let bucketEndMs = nowMs; bucketEndMs > windowStartMs; bucketEndMs -= LOW_BUCKET_MS) {
    const count = countBetween(frameTimesMs, bucketEndMs - LOW_BUCKET_MS, bucketEndMs);
    if (count === 0) continue; // A bucket with nothing drawn is a quiet board, not a stutter.
    if (low === undefined || count < low) low = count;
  }
  return {
    currentFps: current === 0 ? 'idle' : current,
    lowFps: low ?? 'idle',
  };
}

/**
 * Appends a frame's timestamp to a rolling window, dropping timestamps older than `windowMs`.
 * Pure: returns a new array, so a caller keeps its own reference (`this.recentFrameTimesMs =
 * recordFrameTime(this.recentFrameTimesMs, timeMs)`).
 *
 * @param frameTimesMs - The window so far, oldest first.
 * @param timeMs - The new frame's timestamp; assumed newest (the engine's frames are in order).
 * @param windowMs - How long a timestamp is kept; default {@link FRAME_RATE_WINDOW_MS}.
 * @returns The window with `timeMs` appended and anything now too old dropped.
 */
export function recordFrameTime(
  frameTimesMs: readonly number[],
  timeMs: number,
  windowMs: number = FRAME_RATE_WINDOW_MS,
): readonly number[] {
  const cutoffMs = timeMs - windowMs;
  const kept = frameTimesMs.filter((existing) => existing > cutoffMs);
  return [...kept, timeMs];
}
