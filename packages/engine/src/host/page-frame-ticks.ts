import type { EngineThreadPlatform } from './engine-host-platform.js';

/**
 * Where a worker engine's frames come from: the worker's own animation frames, or,
 * where its scope has none, a tick the page posts from its animation frame on request, so the
 * frames keep the display's clock instead of a 16 ms timer's (a 120 Hz display, no judder).
 */
export type FrameSource = 'animation-frame' | 'page-ticks';

/**
 * Where a worker's frames come from. Pure.
 *
 * @param hasAnimationFrames - Whether the worker's scope has `requestAnimationFrame`; `true` if
 *   unknown.
 * @returns `page-ticks` only for a scope known to have none.
 */
export function frameSourceOf(hasAnimationFrames: boolean | undefined): FrameSource {
  return hasAnimationFrames === false ? 'page-ticks' : 'animation-frame';
}

/**
 * A worker's animation frames from the page's: a frame requested asks the page once
 * for a tick, and the tick runs every callback requested since, as one animation frame runs
 * them. Until `connect` gives it a way to ask, requests wait and are asked for on connecting.
 */
export class PageFrameTicks {
  private callbacks = new Map<number, (timeMs: number) => void>();
  /** The frames of the tick running, which a callback may still cancel. */
  private due: Map<number, (timeMs: number) => void> | undefined;
  private nextHandle = 1;
  private isAsked = false;
  private ask: (() => void) | undefined;

  /**
   * Gives the ticks their way to ask the page, asking at once for frames already requested.
   *
   * @param ask - Asks the page for one tick.
   */
  connect(ask: () => void): void {
    this.ask = ask;
    this.askOnce();
  }

  /**
   * Requests a frame, as `requestAnimationFrame` does.
   *
   * @param callback - Runs at the next tick, with its time.
   * @returns A handle for {@link cancel}.
   */
  request(callback: (timeMs: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.askOnce();
    return handle;
  }

  /**
   * Cancels a requested frame.
   *
   * @param handle - What {@link request} returned.
   */
  cancel(handle: number): void {
    this.callbacks.delete(handle);
    this.due?.delete(handle);
  }

  /**
   * Runs the frames requested so far: the page's tick arrived.
   *
   * @param timeMs - The time now, ms on this thread's clock.
   */
  tick(timeMs: number): void {
    this.isAsked = false;
    const due = this.callbacks;
    this.callbacks = new Map();
    this.due = due;
    try {
      for (const [handle, callback] of due) if (due.has(handle)) callback(timeMs);
    } finally {
      this.due = undefined;
    }
  }

  private askOnce(): void {
    if (this.isAsked || this.ask === undefined || this.callbacks.size === 0) return;
    this.isAsked = true;
    this.ask();
  }
}

/**
 * A worker platform whose frames come from the page's ticks where its scope has no animation
 * frames (`frameSourceOf`), and the ticks to connect and feed; the platform unchanged, and no
 * ticks, where it has them.
 *
 * @param platform - The worker's platform.
 * @returns The platform the runtime is to use, and the ticks, if any.
 */
export function withPageFrameTicks<Platform extends EngineThreadPlatform>(
  platform: Platform,
): { readonly platform: Platform; readonly ticks: PageFrameTicks | undefined } {
  if (frameSourceOf(platform.hasAnimationFrames) === 'animation-frame') {
    return { platform, ticks: undefined };
  }
  const ticks = new PageFrameTicks();
  // Over the platform, not a spread copy, so methods on a class platform's prototype stay
  // reachable; the browser platform is closures over its scope, so `this` does not matter.
  // A platform whose methods use `#private` fields or assign to `this` would need a wrapper.
  const framed = Object.create(platform) as Platform;
  Object.assign(framed, {
    requestAnimationFrame: (callback: (timeMs: number) => void) => ticks.request(callback),
    cancelAnimationFrame: (handle: number) => {
      ticks.cancel(handle);
    },
  });
  return { platform: framed, ticks };
}

/**
 * The page's side of the ticks: asked for a tick, it posts one at the page's next
 * animation frame, once however often it was asked meanwhile.
 */
export class PageTickAnswers {
  private isPending = false;

  /**
   * Starts answering.
   *
   * @param post - Posts the tick to the worker.
   * @param requestFrame - Runs a callback at the page's next animation frame; the page's own,
   *   or a zero timer where there is none (a test).
   */
  constructor(
    private readonly post: () => void,
    private readonly requestFrame: (callback: () => void) => void = pageFrame,
  ) {}

  /** Takes the worker's ask: one tick at the next page frame. */
  ask(): void {
    if (this.isPending) return;
    this.isPending = true;
    this.requestFrame(() => {
      this.isPending = false;
      this.post();
    });
  }
}

/**
 * Runs a callback at the page's next animation frame, or after a zero timer where the scope has
 * none (a test: a page without animation frames would tick at the timer's clamp, not the
 * display's rate).
 *
 * @param callback - What to run.
 */
function pageFrame(callback: () => void): void {
  const scope = globalThis as { requestAnimationFrame?: (frame: () => void) => number };
  if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}
