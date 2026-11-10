import type { RetryTimer } from './retry-schedule.js';

/**
 * Asks for a frame at a deadline: the engine draws on request, so something that
 * changes on its own at a known time, such as a GIF's next frame, sets a one-shot timer that
 * calls the host's `requestFrame` then, instead of asking for every frame on the way. The
 * earliest deadline asked for wins; a later one waits for the frame that the earlier one brings.
 * Timed against the frame clock: the delay is the deadline less the frame's time. On the thread
 * that renders.
 */
export class FrameDeadline {
  private stopTimer: (() => void) | undefined;
  private deadlineMs: number | undefined;

  /**
   * Creates the deadline, with nothing waiting.
   *
   * @param timer - Starts one-shot waits (the thread's `setTimeout`, or a test's).
   * @param requestFrame - Asks the host for a frame.
   */
  constructor(
    private readonly timer: RetryTimer,
    private readonly requestFrame: () => void,
  ) {}

  /**
   * Asks for a frame at a time, unless one still to come is already asked for no later.
   *
   * @param deadlineMs - When, ms on the frame clock; `Infinity` asks for nothing.
   * @param nowMs - The current frame's time, ms.
   */
  request(deadlineMs: number, nowMs: number): void {
    if (deadlineMs === Infinity) return;
    // A wait whose time has passed is about to fire: a later deadline gets a wait of its own.
    const pending = this.deadlineMs;
    if (pending !== undefined && pending > nowMs && pending <= deadlineMs) return;
    this.stopTimer?.();
    this.deadlineMs = deadlineMs;
    this.stopTimer = this.timer(
      () => {
        this.stopTimer = undefined;
        this.deadlineMs = undefined;
        this.requestFrame();
      },
      Math.max(0, deadlineMs - nowMs),
    );
  }

  /** Stops the wait, if any: nothing asks for a frame after. */
  stop(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
    this.deadlineMs = undefined;
  }
}
