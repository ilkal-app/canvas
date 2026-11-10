import type { Point } from '@canvas/schema';

import type { ShapeBox } from './new-shape-object.js';

/** A shape made by a click (no drag) is this wide and tall, world units, centred on the click. */
export const DEFAULT_SHAPE_SIZE = 100;

/** A drag never makes a side thinner than this, world units (a shape must have an area). */
export const MIN_SHAPE_SIZE = 1;

/** How a creation drag is shaped. */
export interface ShapeDragModifiers {
  /** Shift: the box is square, as large as the drag's larger side. */
  readonly isSquare: boolean;
  /** Alt (Option): the press is the box's centre, not a corner. */
  readonly isFromCentre: boolean;
}

/**
 * The box a shape tool drag describes: from the press to the pointer,
 * in any direction; square with Shift (the larger side wins, toward the pointer); about the press
 * with Alt, which mirrors the pointer. Never thinner than {@link MIN_SHAPE_SIZE}. Pure.
 *
 * @param press - Where the drag began, world units.
 * @param pointer - Where the pointer is, world units.
 * @param modifiers - Shift and Alt.
 * @returns The box, world units.
 */
export function shapeDragBox(
  press: Point,
  pointer: Point,
  modifiers: ShapeDragModifiers,
): ShapeBox {
  let dx = pointer.x - press.x;
  let dy = pointer.y - press.y;
  if (modifiers.isSquare) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  const width = Math.max(MIN_SHAPE_SIZE, Math.abs(dx) * (modifiers.isFromCentre ? 2 : 1));
  const height = Math.max(MIN_SHAPE_SIZE, Math.abs(dy) * (modifiers.isFromCentre ? 2 : 1));
  if (modifiers.isFromCentre) {
    return { x: press.x - width / 2, y: press.y - height / 2, width, height };
  }
  const x = dx < 0 ? press.x - width : press.x;
  const y = dy < 0 ? press.y - height : press.y;
  return { x, y, width, height };
}

/**
 * The box a click with the shape tool makes: {@link DEFAULT_SHAPE_SIZE} square, centred on the
 * click. Pure.
 *
 * @param centre - The click, world units.
 * @returns The box, world units.
 */
export function clickedShapeBox(centre: Point): ShapeBox {
  const half = DEFAULT_SHAPE_SIZE / 2;
  return {
    x: centre.x - half,
    y: centre.y - half,
    width: DEFAULT_SHAPE_SIZE,
    height: DEFAULT_SHAPE_SIZE,
  };
}
