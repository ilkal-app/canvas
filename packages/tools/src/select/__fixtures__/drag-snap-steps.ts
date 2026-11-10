// Helpers for the snapping tests of the select tool: a 100 × 100 neighbour at the origin as the
// only candidate, and move and resize intents built as the state machine builds them.
import type { WorldBounds } from '@canvas/engine';

import type { SnapGrid } from '../../snap/snap-box.js';
import type { DragSnapContext, MoveIntent, ResizeIntent } from '../drag-snap.js';
import type { ResizeHandle } from '../handle-layout.js';
import type { OrientedBox } from '../oriented-box.js';
import { resizeFrame } from '../resize-frame.js';

/** A 100 × 100 neighbour at the origin: lines at 0, 50 and 100 on both axes. */
export const NEIGHBOUR: WorldBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

/**
 * A snap context whose only candidate is {@link NEIGHBOUR}, 6 world units of reach, and the
 * boxes it was asked about.
 *
 * @param grid - The grid, if any.
 * @returns The context, with `asked` recording each box queried.
 */
export function context(grid?: SnapGrid): DragSnapContext & { asked: WorldBounds[] } {
  const asked: WorldBounds[] = [];
  return {
    asked,
    candidatesNear: (box) => {
      asked.push(box);
      return [NEIGHBOUR];
    },
    thresholdWorld: 6,
    grid,
  };
}

/**
 * A move intent.
 *
 * @param x - The displacement's x, world units.
 * @param y - The displacement's y, world units.
 * @param isAxisLocked - Whether Shift locked it.
 * @returns The intent.
 */
export function move(x: number, y: number, isAxisLocked = false): MoveIntent {
  return { type: 'move', delta: { x, y }, isAxisLocked };
}

/**
 * A resize intent, its frame resized as the state machine resizes it.
 *
 * @param from - The frame when the drag began.
 * @param handle - The handle.
 * @param x - The pointer's displacement's x, world units.
 * @param y - The pointer's displacement's y, world units.
 * @param isProportional - Whether the resize keeps an aspect ratio.
 * @param aspect - The aspect it keeps (a lone image's); the frame's own if absent.
 * @returns The intent.
 */
export function resize(
  from: OrientedBox,
  handle: ResizeHandle,
  x: number,
  y: number,
  isProportional = false,
  aspect?: number,
): ResizeIntent {
  const delta = { x, y };
  return {
    type: 'resize',
    handle,
    delta,
    isProportional,
    ...(aspect === undefined ? {} : { aspect }),
    from,
    to: resizeFrame(from, handle, delta, isProportional, aspect),
  };
}
