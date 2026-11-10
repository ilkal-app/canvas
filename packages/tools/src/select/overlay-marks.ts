import type { WorldBounds } from '@canvas/engine';
import type { Rgba } from '@canvas/schema';

import type { SnapGap } from '../snap/snap-gap.js';

import { boxPointToWorld, worldPointToBox, type OrientedBox } from './oriented-box.js';

/** One flat-colour rectangle of the overlay, turned about its top-left corner. */
export interface OverlayRect {
  /** Where and how large, world units. */
  readonly box: OrientedBox;
  /** Straight-alpha colour. */
  readonly color: Rgba;
}

/** A dash of a locked selection's outline, CSS px (the design's dashed `ink/faint` border). */
export const LOCKED_DASH_PX = 4;

/** The space between two dashes of a locked selection's outline, CSS px. */
export const LOCKED_DASH_GAP_PX = 3;

/** The length of the tick across each end of a gap run, CSS px (1 × 9). */
export const GAP_TICK_PX = 9;

/**
 * A rectangle given in a box's own coordinates, placed in the world.
 *
 * @param box - The box whose frame the rectangle is in.
 * @param x - Left, along the box's x axis, world units.
 * @param y - Top, along the box's y axis, world units.
 * @param width - Width, world units.
 * @param height - Height, world units.
 * @returns The rectangle, turned with the box.
 */
export function inBox(
  box: OrientedBox,
  x: number,
  y: number,
  width: number,
  height: number,
): OrientedBox {
  const corner = boxPointToWorld(box, { x, y });
  return { x: corner.x, y: corner.y, width, height, rotation: box.rotation };
}

/**
 * The four strips of a box's outline, in its own coordinates: just outside its top, bottom, left
 * and right edges, the top and bottom ones reaching over the corners.
 *
 * @param box - The box.
 * @param t - The strip width, world units.
 * @returns The strips as `[x, y, width, height]`.
 */
function outlineStrips(box: OrientedBox, t: number): [number, number, number, number][] {
  const { width, height } = box;
  return [
    [-t, -t, width + 2 * t, t],
    [-t, height, width + 2 * t, t],
    [-t, 0, t, height],
    [width, 0, t, height],
  ];
}

/**
 * A box's outline: four strips of width `t` just outside its edges.
 *
 * @param box - The box.
 * @param t - The strip width, world units.
 * @param color - The strips' colour.
 * @returns The strips.
 */
export function outlineOf(box: OrientedBox, t: number, color: Rgba): OverlayRect[] {
  // Written out, not through `outlineStrips`: a capped selection's 500 outlines are rebuilt at
  // every zoom a glide draws, so this allocates nothing it does not return.
  const { width, height } = box;
  return [
    { box: inBox(box, -t, -t, width + 2 * t, t), color },
    { box: inBox(box, -t, height, width + 2 * t, t), color },
    { box: inBox(box, -t, 0, t, height), color },
    { box: inBox(box, width, 0, t, height), color },
  ];
}

/**
 * The most dashes a locked selection's outline is drawn with. The dashes are cut only where the
 * outline crosses the window the overlay passes (`dashWindowOf`, the view and a margin), which
 * holds about 1,200 at most on a desktop screen; past this cap the outline is drawn solid, so a
 * rebuild (every zoom step) never writes more than this many rectangles.
 */
export const MAX_LOCKED_DASHES = 1536;

/**
 * The window a locked selection's dashes are cut in, for a view: the view grown by a quarter of
 * its width and height on each side, its edges snapped outward to a grid a quarter of the view's
 * size, so it holds still while a pan stays within the margin (the overlay rebuilds only when
 * the window changes) and is at most twice the view each way. Pure.
 *
 * @param visible - What the viewport shows, world units.
 * @returns The window, world units.
 */
export function dashWindowOf(visible: WorldBounds): WorldBounds {
  const stepX = (visible.maxX - visible.minX) / 4;
  const stepY = (visible.maxY - visible.minY) / 4;
  const down = (value: number, step: number) =>
    step > 0 ? Math.floor(value / step) * step : value;
  const up = (value: number, step: number) => (step > 0 ? Math.ceil(value / step) * step : value);
  return {
    minX: down(visible.minX - stepX, stepX),
    minY: down(visible.minY - stepY, stepY),
    maxX: up(visible.maxX + stepX, stepX),
    maxY: up(visible.maxY + stepY, stepY),
  };
}

/**
 * A window in a box's own coordinates: the bounds of its corners mapped into the box's frame.
 *
 * @param box - The box.
 * @param window - The window, world units.
 * @returns The bounds, along the box's axes.
 */
function windowInBox(box: OrientedBox, window: WorldBounds): WorldBounds {
  const corners = [
    { x: window.minX, y: window.minY },
    { x: window.maxX, y: window.minY },
    { x: window.minX, y: window.maxY },
    { x: window.maxX, y: window.maxY },
  ].map((corner) => worldPointToBox(box, corner));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** One strip's dashes to cut: where it is, along which axis, and which dash indices. */
interface StripDashes {
  readonly strip: readonly [number, number, number, number];
  readonly isAlongX: boolean;
  readonly first: number;
  readonly last: number;
}

/**
 * The dashes of each strip that fall in a window (all of them without one), as index ranges.
 *
 * @param box - The box.
 * @param t - The strip width, world units.
 * @param period - A dash and a gap, world units.
 * @param window - The window in the box's coordinates, if any.
 * @returns The ranges, strips that miss the window left out.
 */
function stripDashesOf(
  box: OrientedBox,
  t: number,
  period: number,
  window: WorldBounds | undefined,
): StripDashes[] {
  return outlineStrips(box, t).flatMap((strip): StripDashes[] => {
    const [x, y, width, height] = strip;
    const isAlongX = width >= height;
    const [start, length, across, thickness] = isAlongX
      ? [x, width, y, height]
      : [y, height, x, width];
    let from = 0;
    let to = length;
    if (window) {
      const [low, high, acrossLow, acrossHigh] = isAlongX
        ? [window.minX, window.maxX, window.minY, window.maxY]
        : [window.minY, window.maxY, window.minX, window.maxX];
      if (across + thickness < acrossLow || across > acrossHigh) return [];
      from = Math.max(0, low - start);
      to = Math.min(length, high - start);
      if (to <= from) return [];
    }
    const first = Math.floor(from / period);
    const last = Math.ceil(to / period) - 1;
    return last < first ? [] : [{ strip, isAlongX, first, last }];
  });
}

/**
 * A box's dashed outline (a locked selection): each of the four strips of
 * `outlineOf` cut into dashes of {@link LOCKED_DASH_PX} with gaps of
 * {@link LOCKED_DASH_GAP_PX}, from the strip's start, so the corners are drawn and the pattern
 * keeps its screen size at any zoom. Only the dashes in `window` are cut (the view and a margin,
 * `dashWindowOf`), so a large box at a deep zoom costs what its outline on screen does; above
 * {@link MAX_LOCKED_DASHES} the outline is drawn solid instead. Pure.
 *
 * @param box - The box.
 * @param t - The strip width, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param color - The dashes' colour.
 * @param window - Where dashes are cut, world units; the whole outline if absent.
 * @returns The dashes, strip by strip; at most {@link MAX_LOCKED_DASHES}, or the four solid strips.
 */
export function dashedOutlineOf(
  box: OrientedBox,
  t: number,
  zoom: number,
  color: Rgba,
  window?: WorldBounds,
): OverlayRect[] {
  const dash = LOCKED_DASH_PX / zoom;
  const period = (LOCKED_DASH_PX + LOCKED_DASH_GAP_PX) / zoom;
  const strips = stripDashesOf(box, t, period, window && windowInBox(box, window));
  const count = strips.reduce((total, { first, last }) => total + last - first + 1, 0);
  if (count > MAX_LOCKED_DASHES) return outlineOf(box, t, color);
  const rects: OverlayRect[] = [];
  for (const { strip, isAlongX, first, last } of strips) {
    const [x, y, width, height] = strip;
    const length = isAlongX ? width : height;
    for (let index = first; index <= last; index += 1) {
      const start = index * period;
      const run = Math.min(dash, length - start);
      if (run <= 0) continue;
      const placed = isAlongX
        ? inBox(box, x + start, y, run, height)
        : inBox(box, x, y + start, width, run);
      rects.push({ box: placed, color });
    }
  }
  return rects;
}

/**
 * A gap run: a line one CSS pixel wide across the gap, centred on its position, and a
 * tick {@link GAP_TICK_PX} long across each end, all upright. Pure.
 *
 * @param gap - The run.
 * @param t - The line width, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param color - The colour.
 * @returns The line, then the tick at `from`, then the tick at `to`.
 */
export function gapRunOf(gap: SnapGap, t: number, zoom: number, color: Rgba): OverlayRect[] {
  const tick = GAP_TICK_PX / zoom;
  const length = gap.to - gap.from;
  const at = (along: number, across: number, alongSize: number, acrossSize: number) =>
    gap.axis === 'x'
      ? { x: along, y: across, width: alongSize, height: acrossSize, rotation: 0 }
      : { x: across, y: along, width: acrossSize, height: alongSize, rotation: 0 };
  return [
    { box: at(gap.from, gap.position - t / 2, length, t), color },
    { box: at(gap.from - t / 2, gap.position - tick / 2, t, tick), color },
    { box: at(gap.to - t / 2, gap.position - tick / 2, t, tick), color },
  ];
}
