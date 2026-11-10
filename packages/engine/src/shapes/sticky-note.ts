import type { ShapeColor, ShapeInstance, ShapeRect } from './shape-instance.js';

/** A sticky note's corner radius, in world units (prototype `src/board/note.ts`). */
export const NOTE_CORNER_RADIUS = 3;

/** Straight-alpha black at 28%, frozen with the rest of {@link NOTE_SHADOW}. */
const SHADOW_COLOR: ShapeColor = Object.freeze([0, 0, 0, 0.28] as const);

/**
 * The sticky note's shadow: a blurred dark rounded box, narrower than the note and dropped
 * below it, so it is hidden at the top, faint at the sides and strongest under the bottom edge
 * (the "lifted paper" look). The values were tuned by eye in the prototype
 * (`src/board/note.ts`). Lengths are world units, so the shadow scales
 * with zoom like the note.
 */
export const NOTE_SHADOW = Object.freeze({
  /** Straight-alpha black at 28%. */
  color: SHADOW_COLOR,
  /** How far the shadow is inset from each side of the note, in world units. */
  insetX: 4,
  /** How far below the note's top edge the shadow starts, in world units. */
  offsetTop: 10,
  /** How far below the note's bottom edge the shadow ends, in world units. */
  offsetBottom: 8,
  /** The shadow's corner radius, in world units. */
  radius: 6,
  /** The shadow's blur half-width, in world units. */
  softness: 14,
});

/**
 * The two shape instances that draw a sticky note, shadow first and then the fill, so the tools
 * layer draws a note with one call (prototype `src/app/controller.ts`).
 * Pure: the inputs are not mutated.
 *
 * @param rect - The note's bounds, in world units.
 * @param color - The note's fill colour, straight alpha.
 * @returns `[shadow, fill]`, in draw order.
 */
export function noteInstances(
  rect: ShapeRect,
  color: ShapeColor,
): readonly [ShapeInstance, ShapeInstance] {
  const shadow: ShapeInstance = {
    kind: 'rounded-box',
    x: rect.x + NOTE_SHADOW.insetX,
    y: rect.y + NOTE_SHADOW.offsetTop,
    width: Math.max(0, rect.width - 2 * NOTE_SHADOW.insetX),
    height: Math.max(0, rect.height - NOTE_SHADOW.offsetTop + NOTE_SHADOW.offsetBottom),
    color: NOTE_SHADOW.color,
    radius: NOTE_SHADOW.radius,
    softness: NOTE_SHADOW.softness,
  };
  const fill: ShapeInstance = {
    kind: 'rounded-box',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    color,
    radius: NOTE_CORNER_RADIUS,
    softness: 0,
  };
  return [shadow, fill];
}
