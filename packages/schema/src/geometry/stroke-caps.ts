/**
 * How an open stroke ends: `round` adds a half disc of the stroke's width (the prototype's only
 * cap, and a path's by default), `butt` stops square at the end point, `square` runs on
 * past it by half the width. A line's heads are shapes of their own (`caps.ts`) drawn
 * over a round or butt shaft end chosen through this hook.
 */
export type StrokeCapStyle = 'round' | 'butt' | 'square';

/** A cap style for each end of an open stroke. */
export interface StrokeCaps {
  /** The cap at the polyline's first point. */
  readonly start: StrokeCapStyle;
  /** The cap at its last point. */
  readonly end: StrokeCapStyle;
}

/** One style for both ends, or one per end. */
export type StrokeCapOption = StrokeCapStyle | StrokeCaps;

/**
 * The cap styles of both ends.
 *
 * @param option - One style, or one per end.
 * @returns A style per end.
 */
export function resolveCaps(option: StrokeCapOption): StrokeCaps {
  return typeof option === 'string' ? { start: option, end: option } : option;
}
