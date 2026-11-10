/** A pointer position at a time into a gesture. */
export interface TimedPoint {
  /** When, ms from the gesture's start. */
  readonly atMs: number;
  /** Horizontal position, CSS px on the canvas. */
  readonly xPx: number;
  /** Vertical position, CSS px on the canvas. */
  readonly yPx: number;
}

/** The shape of a {@link dragPath}. */
export interface DragPathOptions {
  /** Where the drag starts and ends, CSS px on the canvas. */
  readonly centre: {
    /** Horizontal, CSS px. */
    readonly xPx: number;
    /** Vertical, CSS px. */
    readonly yPx: number;
  };
  /** How far it swings from the centre, CSS px. */
  readonly amplitudePx: {
    /** Across, CSS px. */
    readonly x: number;
    /** Down, CSS px. */
    readonly y: number;
  };
  /** One swing out and back, ms. */
  readonly periodMs: number;
  /** The whole drag, ms. */
  readonly durationMs: number;
  /** Pointer moves per second. */
  readonly rateHz: number;
}

/**
 * A drag that sweeps back and forth about a centre: a triangle wave across and a sine wave down,
 * so the view keeps moving at a steady speed in every frame and comes back to where it began
 * (whole periods). One point per `1 / rateHz`, from 0 to `durationMs` inclusive. Pure.
 *
 * @param options - The path's centre, swing, period, duration and rate.
 * @returns The points, oldest first.
 */
export function dragPath(options: DragPathOptions): TimedPoint[] {
  const { centre, amplitudePx, periodMs, durationMs, rateHz } = options;
  const stepMs = 1_000 / rateHz;
  // Guards the division against binary rounding (2000 ms at 60 Hz is 119.99999… steps).
  const count = Math.floor((durationMs * rateHz) / 1_000 + 1e-9);
  return Array.from({ length: count + 1 }, (unused, index) => {
    const atMs = Math.min(durationMs, index * stepMs);
    const phase = (atMs / periodMs) % 1;
    // Triangle wave: 0 → 1 → 0 → -1 → 0 over one period.
    const triangle = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
    const wave = Math.sin(2 * Math.PI * phase);
    return {
      atMs,
      xPx: centre.xPx + amplitudePx.x * triangle,
      yPx: centre.yPx + amplitudePx.y * wave,
    };
  });
}
