import { isSameCamera, type Camera } from '@canvas/engine';

/** How long zoom to fit and zoom to selection glide, ms (0 with reduced motion). */
export const FIT_TRANSITION_MS = 240;

/**
 * How long past its duration a glide may go without a frame drawing its target before the mount
 * stops waiting for the engine's frames (a hidden tab, a stalled worker, a frame slower than this
 * on a weak GPU) and settles on the target, ms.
 */
export const GLIDE_SETTLE_SLACK_MS = 500;

/** A glide under way. */
interface Glide {
  /** Where it ends. */
  readonly target: Camera;
  /** The camera its latest frame drew. */
  shown: Camera;
  /** Settles it if frames stop before the target is drawn. */
  readonly settleTimer: ReturnType<typeof setTimeout>;
}

/**
 * A camera glide the engine animates on its own frames (`EngineHost.animateCamera`), as the page
 * follows it through the frame reports: the camera on screen is the one the latest frame drew
 * until a frame draws the target. Should no frame draw the target first, it settles after the
 * glide's duration and {@link GLIDE_SETTLE_SLACK_MS} on the target and says so, so the page never
 * waits on a glide forever. The target, not the camera last drawn: by then the engine's own
 * animation has reached it, and the frame drawing it may only be late (a 50k-object fit on a slow
 * GPU); settling on an earlier camera sent the engine back to it and left the view short
 * of the fit for good. Main thread.
 */
export class EngineGlide {
  private glide: Glide | undefined;
  private readonly onSettle: (target: Camera) => void;

  /**
   * Starts with no glide.
   *
   * @param onSettle - Called with the glide's target when it settles for want of frames.
   */
  constructor(onSettle: (target: Camera) => void) {
    this.onSettle = onSettle;
  }

  /**
   * The camera the glide's latest frame drew.
   *
   * @returns It, or undefined while no glide runs.
   */
  get shown(): Camera | undefined {
    return this.glide?.shown;
  }

  /**
   * Follows a new glide, ending any other.
   *
   * @param from - Where it starts: on screen until a frame draws another camera.
   * @param target - Where it ends.
   * @param durationMs - How long it takes, ms.
   */
  start(from: Camera, target: Camera, durationMs: number): void {
    this.end();
    const settleTimer = setTimeout(() => {
      const glide = this.glide;
      if (glide?.settleTimer !== settleTimer) return;
      this.end();
      this.onSettle(glide.target);
    }, durationMs + GLIDE_SETTLE_SLACK_MS);
    this.glide = { target, shown: from, settleTimer };
  }

  /**
   * Takes a frame's camera: the glide ends when a frame draws its target.
   *
   * @param drawn - The camera the frame drew, if any.
   * @returns Whether a glide was under way, so the camera on screen changed.
   */
  follow(drawn: Camera | undefined): boolean {
    const { glide } = this;
    if (glide === undefined || drawn === undefined) return false;
    if (isSameCamera(drawn, glide.target)) this.end();
    else glide.shown = drawn;
    return true;
  }

  /** Stops following the glide, if one runs. */
  end(): void {
    if (this.glide === undefined) return;
    clearTimeout(this.glide.settleTimer);
    this.glide = undefined;
  }
}
