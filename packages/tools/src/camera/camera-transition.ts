import type { Camera } from '@canvas/engine';

/** How a {@link CameraTransition} runs. */
export interface CameraTransitionOptions {
  /** How long the transition takes, ms; 0 jumps (reduced motion). */
  readonly durationMs: number;
  /** The time now, ms; injected so tests control it (Global Constraint 3). */
  readonly clock: () => number;
}

/**
 * The camera part way from one camera to another. The zoom moves geometrically (equal ratios
 * in equal steps, so zooming 1× → 4× passes 2× halfway) and the world point at the viewport's
 * centre moves in a straight line, so a fit glides rather than swinging about a corner. The
 * viewport is the target's.
 *
 * @param from - Where the transition starts.
 * @param to - Where it ends.
 * @param progress - 0 at `from`, 1 at `to`; values outside are clamped.
 * @returns The camera at `progress`; `to` itself at 1.
 */
export function interpolateCamera(from: Camera, to: Camera, progress: number): Camera {
  if (progress >= 1) return to;
  const t = Math.max(0, progress);
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
  const fromCentreX = from.x + from.viewportWidthPx / (2 * from.zoom);
  const fromCentreY = from.y + from.viewportHeightPx / (2 * from.zoom);
  const toCentreX = to.x + to.viewportWidthPx / (2 * to.zoom);
  const toCentreY = to.y + to.viewportHeightPx / (2 * to.zoom);
  const centreX = fromCentreX + (toCentreX - fromCentreX) * t;
  const centreY = fromCentreY + (toCentreY - fromCentreY) * t;
  return {
    ...to,
    zoom,
    x: centreX - to.viewportWidthPx / (2 * zoom),
    y: centreY - to.viewportHeightPx / (2 * zoom),
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * An animated camera move, for zoom to fit and zoom to selection: eased in and out, without
 * inertia, timed by an injected clock. The caller samples it once per frame until it is
 * finished. With `durationMs` 0 it is finished from the start and samples as the target.
 */
export class CameraTransition {
  /** Where the transition ends. */
  readonly target: Camera;
  private readonly from: Camera;
  private readonly durationMs: number;
  private readonly clock: () => number;
  private readonly startMs: number;

  /**
   * Starts a transition now, by the clock.
   *
   * @param from - The camera now.
   * @param to - The camera to end at.
   * @param options - The duration and the clock.
   * @throws {RangeError} When the duration is negative or not finite.
   */
  constructor(from: Camera, to: Camera, options: CameraTransitionOptions) {
    if (!(options.durationMs >= 0) || !Number.isFinite(options.durationMs)) {
      throw new RangeError(
        `A transition lasts zero or more ms, not ${String(options.durationMs)}.`,
      );
    }
    this.from = from;
    this.target = to;
    this.durationMs = options.durationMs;
    this.clock = options.clock;
    this.startMs = options.clock();
  }

  /**
   * The camera to show now.
   *
   * @returns The interpolated camera; the target itself once finished.
   */
  sample(): Camera {
    return interpolateCamera(this.from, this.target, easeInOutCubic(this.progress()));
  }

  /**
   * Whether the transition has reached its target.
   *
   * @returns True once the duration has passed.
   */
  isFinished(): boolean {
    return this.progress() >= 1;
  }

  private progress(): number {
    if (this.durationMs === 0) return 1;
    return Math.min(1, (this.clock() - this.startMs) / this.durationMs);
  }
}
