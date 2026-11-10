import type { Point } from '@canvas/schema';

import { worldPointToBox } from './oriented-box.js';
import type { SelectionCorner } from './rotation-band.js';
import type { SelectDrag } from './select-drag.js';
import { frameControlAt, type PressTarget, type SelectToolContext } from './select-press.js';

/**
 * The rotate cursor, turned to match its corner: like Figma's, its curved arrow wraps
 * the corner of the selection frame it sits outside of, so the four corners differ by a quarter
 * turn whatever the frame's aspect ratio, and the set turns with a turned selection.
 */
export interface RotateCursor {
  /** Names the cursor. */
  readonly kind: 'rotate';
  /**
   * How far the icon is turned from its untouched orientation (whose arc wraps a top-left
   * corner), radians, clockwise on screen (y points down): the corner's quarter turn (top-left
   * 0, top-right π/2, bottom-right π, bottom-left 3π/2) plus the selection frame's rotation.
   * Any number of turns; the camera never turns, so the angle on the board is the one on
   * screen. The app quantises it to {@link ROTATE_CURSOR_STEPS} orientations with
   * {@link rotateCursorStepOf}; a cursor object is kept while its step holds, so this is the
   * angle when the step last changed.
   */
  readonly angle: number;
}

/**
 * The pointer cursor the select tool asks for: the {@link RotateCursor}
 * over a rotation band and for the whole of a rotation drag, `default` otherwise. The app maps
 * it to a CSS cursor; this package names it only.
 */
export type SelectCursor = 'default' | RotateCursor;

/** How many orientations the rotate cursor takes: one every 15°. */
export const ROTATE_CURSOR_STEPS = 24;

/** One orientation step of the rotate cursor, radians (15°). */
const STEP_ANGLE = (2 * Math.PI) / ROTATE_CURSOR_STEPS;

/** Each corner's quarter turn of the icon, radians clockwise, before the frame's rotation. */
const CORNER_TURN: Readonly<Record<SelectionCorner, number>> = {
  nw: 0,
  ne: Math.PI / 2,
  se: Math.PI,
  sw: (3 * Math.PI) / 2,
};

/**
 * The orientation step of a rotate cursor's angle: the nearest multiple of 15°, clockwise from
 * the untouched icon. The app keeps one cursor image per step.
 *
 * @param angle - The angle, radians, any turn.
 * @returns The step, an integer in [0, {@link ROTATE_CURSOR_STEPS}).
 */
export function rotateCursorStepOf(angle: number): number {
  const step = Math.round(angle / STEP_ANGLE) % ROTATE_CURSOR_STEPS;
  return (step + ROTATE_CURSOR_STEPS) % ROTATE_CURSOR_STEPS;
}

/**
 * The rotate cursor at an angle, or `previous` when it is the rotate cursor in the same step,
 * so an unchanged orientation allocates nothing.
 *
 * @param angle - The angle, radians.
 * @param previous - The cursor shown now.
 * @returns The cursor.
 */
function rotateCursorAt(angle: number, previous: SelectCursor): RotateCursor {
  if (previous !== 'default' && rotateCursorStepOf(previous.angle) === rotateCursorStepOf(angle))
    return previous;
  return { kind: 'rotate', angle };
}

/**
 * The cursor for what a press landed on, held from the press to the release (and turned with
 * the selection through a rotation drag: {@link cursorOfDrag}). Constant time.
 *
 * @param target - What the press landed on.
 * @param previous - The cursor shown now.
 * @returns The rotate cursor for a rotation band, turned to its corner and the frame's
 *   rotation, else `default`.
 */
export function cursorOfTarget(
  target: PressTarget | undefined,
  previous: SelectCursor = 'default',
): SelectCursor {
  return target?.kind === 'rotation'
    ? rotateCursorAt(CORNER_TURN[target.corner] + target.frame.rotation, previous)
    : 'default';
}

/**
 * The corner of a frame whose outside quadrant a point lies in: the band a rotation drag
 * started from.
 *
 * @param local - The point in the frame's own axes, from its top-left corner.
 * @param width - The frame's width.
 * @param height - The frame's height.
 * @returns The corner.
 */
function cornerQuadrantOf(local: Point, width: number, height: number): SelectionCorner {
  const isWest = local.x < width / 2;
  if (local.y < height / 2) return isWest ? 'nw' : 'ne';
  return isWest ? 'sw' : 'se';
}

/**
 * The cursor through a drag: a rotation turns it with the selection, as the rotate cursor of
 * the corner the drag started from on the frame turned by the angle swept about the pivot so
 * far (before any Shift snap); any other drag keeps the one it started with.
 *
 * @param drag - The drag under way.
 * @param start - The press, world units.
 * @param point - The pointer, world units.
 * @param previous - The cursor shown now.
 * @returns The cursor.
 */
export function cursorOfDrag(
  drag: SelectDrag,
  start: Point,
  point: Point,
  previous: SelectCursor,
): SelectCursor {
  if (drag.kind !== 'rotate') return previous;
  const { from, pivot } = drag;
  const corner = cornerQuadrantOf(worldPointToBox(from, start), from.width, from.height);
  const swept =
    Math.atan2(point.y - pivot.y, point.x - pivot.x) -
    Math.atan2(start.y - pivot.y, start.x - pivot.x);
  return rotateCursorAt(CORNER_TURN[corner] + from.rotation + swept, previous);
}

/**
 * The cursor while hovering at a point with no button down: the rotate cursor in a corner's
 * rotation band, turned to that corner and the frame's rotation, except where a resize handle
 * in front of it takes the press (`frameControlAt`). Pure; asks no hit tester.
 *
 * @param point - The pointer, world units.
 * @param context - The frame, the zoom, whether the selection can be resized or is locked, the
 *   selection and the view (the count badge hides the controls under it).
 * @param previous - The cursor shown now: returned as it is when the orientation keeps its step.
 * @returns The cursor.
 */
export function hoverCursorAt(
  point: Point,
  context: Pick<
    SelectToolContext,
    'frame' | 'zoom' | 'canResize' | 'isLocked' | 'hasFrameControls' | 'selection' | 'visible'
  >,
  previous: SelectCursor = 'default',
): SelectCursor {
  return cursorOfTarget(frameControlAt(point, context), previous);
}
