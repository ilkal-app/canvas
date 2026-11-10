import type { Point } from '@canvas/schema';

import { boxPointToWorld, worldPointToBox, type OrientedBox } from './oriented-box.js';
import type { SelectPointerType } from './select-input.js';

/**
 * The eight resize handles, named by compass point: corners first, then edges, which is also
 * the order a press looks for them in, so a corner wins where a tiny frame makes them overlap.
 */
export const RESIZE_HANDLES = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as const;

/** One of {@link RESIZE_HANDLES}: which edges of the frame it drags. */
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** A handle's drawn side, CSS px, whatever the zoom (the prototype's `HANDLE_PX`). */
export const HANDLE_SIZE_PX = 8;

/** A handle's pickable side, CSS px: a little larger than drawn, so it is easy to grab. */
export const HANDLE_HIT_SIZE_PX = 12;

/**
 * Which resize handles a selection offers: all of them (`true`), none (`false`), or only the
 * edge handles along one axis, `'x'` (east and west) or `'y'` (north and south), for a lone
 * group whose derived box has no length along the other axis, which a resize cannot scale.
 */
export type ResizeAbility = boolean | 'x' | 'y';

/** The handles each ability offers, in pick order. */
const HANDLES_OF: Readonly<Record<'x' | 'y', readonly ResizeHandle[]>> = {
  x: ['e', 'w'],
  y: ['n', 's'],
};

/**
 * The handles a selection offers.
 *
 * @param canResize - Which handles the selection can be resized by.
 * @returns The handles, in pick order.
 */
function offeredHandles(canResize: ResizeAbility): readonly ResizeHandle[] {
  if (canResize === false) return [];
  return canResize === true ? RESIZE_HANDLES : HANDLES_OF[canResize];
}

/**
 * A handle's pickable side for a finger, CSS px: 44 px, the smallest target a fingertip hits
 * reliably (Apple's Human Interface Guidelines). Drawn handles keep {@link HANDLE_SIZE_PX}. The
 * square is not centred on the handle: it reaches into the frame at most
 * {@link TOUCH_HANDLE_INWARD_REACH_PX} and the rest of the way out of it (`touchInwardReachPx`).
 */
export const TOUCH_HANDLE_HIT_SIZE_PX = 44;

/**
 * The farthest a finger's handle square reaches into the frame, CSS px, across the edge its
 * handle sits on: the square lies mostly outside the frame, so a finger on a small selected
 * object moves it rather than grabbing a handle.
 */
export const TOUCH_HANDLE_INWARD_REACH_PX = 6;

/**
 * How far a finger's handle square reaches into the frame along one of its axes, CSS px:
 * {@link TOUCH_HANDLE_INWARD_REACH_PX}, or a sixth of the frame's on-screen side along that
 * axis if less, so at least the middle two thirds of the frame along each axis are left to the
 * object. The square reaches {@link TOUCH_HANDLE_HIT_SIZE_PX} less this
 * out of the frame, 38 px or more. Pure.
 *
 * @param sidePx - The frame's side along the axis, CSS px on screen.
 * @returns The inward reach, CSS px.
 */
export function touchInwardReachPx(sidePx: number): number {
  return Math.min(TOUCH_HANDLE_INWARD_REACH_PX, Math.max(0, sidePx) / 6);
}

/**
 * How far a finger's corner handle squares reach out of the frame's corners, CSS px, along the
 * axis where they reach least: {@link TOUCH_HANDLE_HIT_SIZE_PX} less the larger inward reach.
 * The rotation bands begin there (`hitRotationBand`). Pure.
 *
 * @param frame - The selection frame, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @returns The outward reach, CSS px.
 */
export function touchCornerOutwardReachPx(frame: OrientedBox, zoom: number): number {
  const inward = Math.max(
    touchInwardReachPx(frame.width * zoom),
    touchInwardReachPx(frame.height * zoom),
  );
  return TOUCH_HANDLE_HIT_SIZE_PX - inward;
}

/**
 * A handle's pickable side for a kind of pointer: {@link TOUCH_HANDLE_HIT_SIZE_PX} for touch,
 * {@link HANDLE_HIT_SIZE_PX} for a mouse or a pen.
 *
 * @param pointerType - The pointer; `mouse` if absent.
 * @returns The side, CSS px.
 */
export function handleHitSizePx(pointerType: SelectPointerType = 'mouse'): number {
  return pointerType === 'touch' ? TOUCH_HANDLE_HIT_SIZE_PX : HANDLE_HIT_SIZE_PX;
}

/** Where one handle is drawn and picked. */
export interface HandlePlacement {
  /** Which handle. */
  readonly handle: ResizeHandle;
  /** Its centre, world units. */
  readonly centre: Point;
  /** Its drawn side, world units: {@link HANDLE_SIZE_PX} at the given zoom. */
  readonly size: number;
}

/**
 * Where each handle sits in the frame's own coordinates, world units.
 *
 * @param frame - The selection frame.
 * @param handle - The handle.
 * @returns The handle's centre along the frame's axes.
 */
function localCentreOf(frame: OrientedBox, handle: ResizeHandle): Point {
  const { width, height } = frame;
  switch (handle) {
    case 'nw':
      return { x: 0, y: 0 };
    case 'ne':
      return { x: width, y: 0 };
    case 'se':
      return { x: width, y: height };
    case 'sw':
      return { x: 0, y: height };
    case 'n':
      return { x: width / 2, y: 0 };
    case 'e':
      return { x: width, y: height / 2 };
    case 's':
      return { x: width / 2, y: height };
    case 'w':
      return { x: 0, y: height / 2 };
  }
}

/**
 * The handles of a selection frame: the eight
 * resize handles on its corners and edge midpoints, turned with the frame. There is no rotate
 * handle: rotation starts from the bands just outside the corners (`hitRotationBand`). Sizes
 * are divided by the zoom, so handles keep one screen size at every zoom. Pure.
 *
 * @param frame - The selection frame, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param canResize - Which handles the selection offers (`ResizeAbility`); none when false.
 * @returns The handles, in pick order.
 */
export function handleLayout(
  frame: OrientedBox,
  zoom: number,
  canResize: ResizeAbility,
): HandlePlacement[] {
  const size = HANDLE_SIZE_PX / zoom;
  return offeredHandles(canResize).map((handle) => ({
    handle,
    centre: boxPointToWorld(frame, localCentreOf(frame, handle)),
    size,
  }));
}

/** Where a handle sits along one of the frame's axes: its start, its middle or its end. */
type AxisPlace = 'start' | 'middle' | 'end';

/** Where each handle sits along the frame's x and y axes. */
const PLACES_OF: Readonly<Record<ResizeHandle, readonly [AxisPlace, AxisPlace]>> = {
  nw: ['start', 'start'],
  ne: ['end', 'start'],
  se: ['end', 'end'],
  sw: ['start', 'end'],
  n: ['middle', 'start'],
  e: ['end', 'middle'],
  s: ['middle', 'end'],
  w: ['start', 'middle'],
};

/**
 * Whether a coordinate along one of the frame's axes is inside a finger's handle square there:
 * centred on a middle handle; from {@link touchInwardReachPx} inside an end of the frame to
 * {@link TOUCH_HANDLE_HIT_SIZE_PX} less that outside it.
 *
 * @param value - The coordinate, world units along the axis from the frame's start.
 * @param place - Where the handle sits along the axis.
 * @param length - The frame's side along the axis, world units.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns True inside the square's span.
 */
function isInTouchSpan(value: number, place: AxisPlace, length: number, zoom: number): boolean {
  if (place === 'middle')
    return Math.abs(value - length / 2) <= TOUCH_HANDLE_HIT_SIZE_PX / 2 / zoom;
  const inward = touchInwardReachPx(length * zoom) / zoom;
  const outward = TOUCH_HANDLE_HIT_SIZE_PX / zoom - inward;
  const fromEdge = place === 'start' ? -value : value - length;
  return fromEdge >= -inward && fromEdge <= outward;
}

/**
 * Whether a point is on a handle's pickable square: centred on the handle, the side
 * {@link HANDLE_HIT_SIZE_PX}, for a mouse or a pen; for a finger, {@link TOUCH_HANDLE_HIT_SIZE_PX}
 * biased out of the frame (`isInTouchSpan`).
 *
 * @param local - The point in the frame's own axes, world units.
 * @param frame - The selection frame.
 * @param handle - The handle.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param pointerType - The pointer.
 * @returns True on the square.
 */
function isOnHandleSquare(
  local: Point,
  frame: OrientedBox,
  handle: ResizeHandle,
  zoom: number,
  pointerType: SelectPointerType,
): boolean {
  if (pointerType === 'touch') {
    const [placeX, placeY] = PLACES_OF[handle];
    return (
      isInTouchSpan(local.x, placeX, frame.width, zoom) &&
      isInTouchSpan(local.y, placeY, frame.height, zoom)
    );
  }
  const centre = localCentreOf(frame, handle);
  const reach = HANDLE_HIT_SIZE_PX / 2 / zoom;
  return Math.abs(local.x - centre.x) <= reach && Math.abs(local.y - centre.y) <= reach;
}

/**
 * The handle under a world point, if any: the first handle, in {@link handleLayout}'s order,
 * whose pickable square (turned with the frame) holds the point: {@link HANDLE_HIT_SIZE_PX},
 * centred on the handle, for a mouse or a pen; {@link TOUCH_HANDLE_HIT_SIZE_PX} for a finger,
 * reaching into the frame at most {@link TOUCH_HANDLE_INWARD_REACH_PX} (or a sixth of the
 * frame's on-screen side) and the rest of the way out of it, so a finger on a small selected
 * object still moves it. Handles take priority over the rotation bands
 * and objects, so the select tool asks this first.
 *
 * @param frame - The selection frame, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param point - The pointer, world units.
 * @param canResize - Which handles the selection offers (`ResizeAbility`).
 * @param pointerType - The pointer, which sizes the squares; `mouse` if absent.
 * @returns The handle, or undefined; always undefined when the selection cannot be resized.
 */
export function hitHandle(
  frame: OrientedBox,
  zoom: number,
  point: Point,
  canResize: ResizeAbility,
  pointerType: SelectPointerType = 'mouse',
): ResizeHandle | undefined {
  const local = worldPointToBox(frame, point);
  return offeredHandles(canResize).find((handle) =>
    isOnHandleSquare(local, frame, handle, zoom, pointerType),
  );
}
