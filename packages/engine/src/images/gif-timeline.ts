/** Which frame an animation shows at a moment, and when that changes. */
export interface AnimationMoment {
  /** The frame shown, from 0. */
  readonly index: number;
  /**
   * When the next frame starts, ms after playback started; undefined once the last play has
   * reached its last frame, which then stays.
   */
  readonly nextChangeMs: number | undefined;
}

/**
 * The frame an animation shows a time after it started: the
 * frames follow one another for their durations, the whole sequence plays `plays` times, and
 * after the last play the last frame stays, as browsers end a GIF. Time before the start shows
 * the first frame. Pure: the clock is the caller's (the frame's time, frozen in tests and golden
 * scenes).
 *
 * @param durationsMs - Each frame's duration, ms, all positive.
 * @param plays - How many times the sequence plays: a positive whole number, or `Infinity`.
 * @param elapsedMs - The time since playback started, ms.
 * @returns The frame and when the next one starts.
 * @throws {RangeError} When there is no frame, a duration is not positive, or `plays` is not a
 *   positive whole number or `Infinity`.
 */
export function animationMomentAt(
  durationsMs: readonly number[],
  plays: number,
  elapsedMs: number,
): AnimationMoment {
  if (durationsMs.length === 0) throw new RangeError('An animation has at least one frame.');
  if (!durationsMs.every((duration) => Number.isFinite(duration) && duration > 0)) {
    throw new RangeError('Every frame of an animation shows for a positive time.');
  }
  if (!(plays === Infinity || (Number.isInteger(plays) && plays > 0))) {
    throw new RangeError(
      `An animation plays a positive whole number of times; received ${String(plays)}.`,
    );
  }
  const lastIndex = durationsMs.length - 1;
  const cycleMs = durationsMs.reduce((sum, duration) => sum + duration, 0);
  const time = Math.max(0, elapsedMs);
  const play = Math.floor(time / cycleMs);
  if (play >= plays) return { index: lastIndex, nextChangeMs: undefined };
  const playStartMs = play * cycleMs;
  let endMs = playStartMs;
  // The last frame takes whatever rounding leaves of the play.
  const index = durationsMs.findIndex((duration, at) => {
    endMs += duration;
    return time < endMs || at === lastIndex;
  });
  const isFinal = index === lastIndex && play === plays - 1;
  return { index, nextChangeMs: isFinal ? undefined : endMs };
}
