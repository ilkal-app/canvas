import type { WorldBounds } from '@canvas/engine';

import { boxAround, boxCornersOf, boxPointToWorld, type OrientedBox } from './oriented-box.js';

/** The gap between the selection frame's bottom edge and the count badge, CSS px. */
export const COUNT_BADGE_GAP_PX = 12;

/** The least space the badge keeps from the viewport's edges, CSS px. */
export const COUNT_BADGE_MARGIN_PX = 8;

/** A digit's width, CSS px. */
const DIGIT_WIDTH_PX = 6;

/** A digit's height, CSS px. */
const DIGIT_HEIGHT_PX = 10;

/** A digit's stroke, CSS px. */
const STROKE_PX = 2;

/** The space between two digits, CSS px. */
const DIGIT_GAP_PX = 2;

/** The badge's padding left and right of its digits, CSS px. */
const PADDING_X_PX = 4;

/** The badge's padding above and below its digits, CSS px. */
const PADDING_Y_PX = 3;

/** The badge's height, CSS px, whatever the zoom. */
export const COUNT_BADGE_HEIGHT_PX = DIGIT_HEIGHT_PX + 2 * PADDING_Y_PX;

/** A stroke of a digit: `[x, y, width, height]` in the digit's cell, CSS px. */
type Stroke = readonly [number, number, number, number];

const HALF_HEIGHT_PX = (DIGIT_HEIGHT_PX + STROKE_PX) / 2;
const MIDDLE_PX = (DIGIT_HEIGHT_PX - STROKE_PX) / 2;
const RIGHT_PX = DIGIT_WIDTH_PX - STROKE_PX;

/** The seven segments' names: `a` (top) clockwise to `f` (upper left), then `g` (middle). */
type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

/** Each segment's stroke. */
const SEGMENTS: Readonly<Record<Segment, Stroke>> = {
  a: [0, 0, DIGIT_WIDTH_PX, STROKE_PX],
  b: [RIGHT_PX, 0, STROKE_PX, HALF_HEIGHT_PX],
  c: [RIGHT_PX, MIDDLE_PX, STROKE_PX, HALF_HEIGHT_PX],
  d: [0, DIGIT_HEIGHT_PX - STROKE_PX, DIGIT_WIDTH_PX, STROKE_PX],
  e: [0, MIDDLE_PX, STROKE_PX, HALF_HEIGHT_PX],
  f: [0, 0, STROKE_PX, HALF_HEIGHT_PX],
  g: [0, MIDDLE_PX, DIGIT_WIDTH_PX, STROKE_PX],
};

/** Each digit's lit segments, 0 to 9. */
const DIGIT_SEGMENTS: readonly (readonly Segment[])[] = [
  ['a', 'b', 'c', 'd', 'e', 'f'],
  ['b', 'c'],
  ['a', 'b', 'd', 'e', 'g'],
  ['a', 'b', 'c', 'd', 'g'],
  ['b', 'c', 'f', 'g'],
  ['a', 'c', 'd', 'f', 'g'],
  ['a', 'c', 'd', 'e', 'f', 'g'],
  ['a', 'b', 'c'],
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  ['a', 'b', 'c', 'd', 'f', 'g'],
];

/**
 * A count's decimal digits.
 *
 * @param count - A positive integer.
 * @returns Its digits, most significant first.
 */
function digitsOf(count: number): number[] {
  const digits: number[] = [];
  let rest = Math.max(1, Math.floor(count));
  while (rest > 0) {
    digits.unshift(rest % 10);
    rest = Math.floor(rest / 10);
  }
  return digits;
}

/** Where the count badge and its digits' strokes sit, turned with the selection frame. */
export interface CountBadgeLayout {
  /** The badge's background, world units. */
  readonly badge: OrientedBox;
  /** Each digit's strokes, left to right, world units. */
  readonly segments: readonly OrientedBox[];
}

/**
 * Clamps a value into a range; a range too narrow for it gives its start.
 *
 * @param value - The value.
 * @param min - The least value.
 * @param max - The greatest value.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Whether a box lies wholly inside bounds.
 *
 * @param box - The box, world units.
 * @param bounds - The bounds, world units.
 * @returns True when every corner is inside.
 */
function isWithin(box: OrientedBox, bounds: WorldBounds): boolean {
  const around = boxAround(boxCornersOf(box));
  return (
    around !== undefined &&
    around.x >= bounds.minX &&
    around.y >= bounds.minY &&
    around.x + around.width <= bounds.maxX &&
    around.y + around.height <= bounds.maxY
  );
}

/**
 * Where the badge's background goes: centred below the frame in its own axes; where
 * that leaves the viewport (inset by {@link COUNT_BADGE_MARGIN_PX}), above the frame; where that
 * does too, pinned to the viewport's bottom edge, under the frame's centre as far as the
 * viewport allows. An unturned frame's badge also slides sideways to stay inside, so a frame
 * wider than the viewport keeps its badge in view below or above it.
 *
 * @param frame - The selection frame.
 * @param width - The badge's width, world units.
 * @param height - The badge's height, world units.
 * @param zoom - The camera zoom.
 * @param visible - The world the viewport shows, or undefined to keep the badge below the frame.
 * @returns The badge's box, world units.
 */
function placeBadge(
  frame: OrientedBox,
  width: number,
  height: number,
  zoom: number,
  visible: WorldBounds | undefined,
): OrientedBox {
  const gap = COUNT_BADGE_GAP_PX / zoom;
  const at = (top: number): OrientedBox => {
    const corner = boxPointToWorld(frame, { x: frame.width / 2 - width / 2, y: top });
    return { x: corner.x, y: corner.y, width, height, rotation: frame.rotation };
  };
  const below = at(frame.height + gap);
  if (visible === undefined) return below;
  const margin = COUNT_BADGE_MARGIN_PX / zoom;
  const inset: WorldBounds = {
    minX: visible.minX + margin,
    minY: visible.minY + margin,
    maxX: visible.maxX - margin,
    maxY: visible.maxY - margin,
  };
  const slide = (box: OrientedBox): OrientedBox =>
    box.rotation === 0 ? { ...box, x: clamp(box.x, inset.minX, inset.maxX - width) } : box;
  for (const candidate of [below, at(-gap - height)].map(slide)) {
    if (isWithin(candidate, inset)) return candidate;
  }
  const centre = boxPointToWorld(frame, { x: frame.width / 2, y: frame.height / 2 });
  return {
    x: clamp(centre.x - width / 2, inset.minX, inset.maxX - width),
    y: Math.max(inset.minY, inset.maxY - height),
    width,
    height,
    rotation: 0,
  };
}

/**
 * The count badge a capped selection shows (the selection overlay has no text, so its
 * digits are seven-segment strokes of flat rectangles, like the rest of the overlay): a pill
 * {@link COUNT_BADGE_HEIGHT_PX} high and as wide as its digits, centred
 * {@link COUNT_BADGE_GAP_PX} below the frame's bottom edge, clear of the bottom handle, in the
 * frame's own axes, and kept inside the viewport when one is given (`placeBadge`: above the
 * frame, else pinned to the bottom edge). Sizes are divided by the zoom, so it keeps one screen
 * size. Pure.
 *
 * @param frame - The selection frame.
 * @param count - The number to show, a positive integer.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param visible - The world the viewport shows (`visibleWorldBounds`); undefined keeps the
 *   badge below the frame wherever that is.
 * @returns The badge and its strokes, world units; O(digits).
 */
export function countBadgeLayout(
  frame: OrientedBox,
  count: number,
  zoom: number,
  visible?: WorldBounds,
): CountBadgeLayout {
  const digits = digitsOf(count);
  const widthPx =
    2 * PADDING_X_PX + digits.length * DIGIT_WIDTH_PX + (digits.length - 1) * DIGIT_GAP_PX;
  const badge = placeBadge(frame, widthPx / zoom, COUNT_BADGE_HEIGHT_PX / zoom, zoom, visible);
  const place = (x: number, y: number, width: number, height: number): OrientedBox => {
    const corner = boxPointToWorld(badge, { x, y });
    return { x: corner.x, y: corner.y, width, height, rotation: badge.rotation };
  };
  const segments = digits.flatMap((digit, index) => {
    const cellX = (PADDING_X_PX + index * (DIGIT_WIDTH_PX + DIGIT_GAP_PX)) / zoom;
    const cellY = PADDING_Y_PX / zoom;
    return (DIGIT_SEGMENTS[digit] ?? []).map((segment) => {
      const [x, y, width, height] = SEGMENTS[segment];
      return place(cellX + x / zoom, cellY + y / zoom, width / zoom, height / zoom);
    });
  });
  return { badge, segments };
}
