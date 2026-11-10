import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, type ScreenPoint } from '@canvas/tools';

/**
 * The long-press timer of a finger's press:
 * fires once, `LONG_PRESS_MS` after the press, with the time and where the finger is then;
 * stops once the finger has wandered `LONG_PRESS_SLOP_PX` from where it landed (a drag, or a
 * press on something a drag does not move, such as the count badge, that is no long-press).
 * Main thread.
 */
export class LongPressTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pressedAt = 0;
  private landing: ScreenPoint = { x: 0, y: 0 };
  private screen: ScreenPoint = { x: 0, y: 0 };
  private readonly onHold: (timeStamp: number, screen: ScreenPoint) => void;
  private readonly clock: () => number;

  /**
   * Starts stopped.
   *
   * @param onHold - Receives the time (ms, the events' clock) and the finger's place (CSS px on
   *   the canvas) when the press has been held long enough.
   * @param clock - The time now, ms, on the events' `timeStamp` clock (`performance.now`).
   */
  constructor(onHold: (timeStamp: number, screen: ScreenPoint) => void, clock: () => number) {
    this.onHold = onHold;
    this.clock = clock;
  }

  /**
   * Times a finger's press.
   *
   * @param timeStamp - When the finger landed, ms (the event's `timeStamp`).
   * @param screen - Where, CSS px on the canvas.
   */
  start(timeStamp: number, screen: ScreenPoint): void {
    this.stop();
    this.pressedAt = timeStamp;
    this.landing = screen;
    this.screen = screen;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // A timer may fire a fraction of a millisecond early by the page's clock: it is the delay.
      this.onHold(Math.max(this.clock(), this.pressedAt + LONG_PRESS_MS), this.screen);
    }, LONG_PRESS_MS);
  }

  /**
   * Follows the finger: once it is `LONG_PRESS_SLOP_PX` or more from where it landed, the press
   * is no long-press and the timer stops.
   *
   * @param screen - Where the finger is now, CSS px on the canvas.
   */
  follow(screen: ScreenPoint): void {
    if (this.timer === undefined) return;
    this.screen = screen;
    const distance = Math.hypot(screen.x - this.landing.x, screen.y - this.landing.y);
    if (distance >= LONG_PRESS_SLOP_PX) this.stop();
  }

  /** Stops the timer; nothing fires. */
  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
