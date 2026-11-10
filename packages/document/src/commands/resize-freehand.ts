import { freehandLocalBounds, type Board, type FreehandObject, type Point } from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import type { CommandContext } from './command.js';
import { finiteGeometry } from './finite-geometry.js';
import type { PlannedPatch } from './object-patches.js';
import { boardToParentFrame } from './world-frame.js';

/** A resize to a size or by a change of size, as the input schema gives it. */
export type FreehandResizeEntry =
  | {
      /** The new size of the inked box, world units. */
      readonly to: { readonly width: number; readonly height: number };
      /** Where the box's top-left corner goes; omit to keep it. */
      readonly origin?: Point | undefined;
    }
  | {
      /** The change of the inked box's size, world units. */
      readonly by: { readonly width: number; readonly height: number };
      /** Where the box's top-left corner goes; omit to keep it. */
      readonly origin?: Point | undefined;
    };

/** A freehand stroke named by a resize, its entry and the entry's path in the input. */
export interface FreehandResizeItem {
  /** The stroke. */
  readonly object: FreehandObject;
  /** Its resize. */
  readonly entry: FreehandResizeEntry;
  /** The entry's path in the input. */
  readonly path: readonly (string | number)[];
}

/** What one freehand resize writes: a patch, or the errors that refuse it. */
export interface FreehandEntryPlan {
  /** The patch. */
  readonly patches: readonly PlannedPatch[];
  /** The errors. */
  readonly errors: readonly CommandError[];
}

/**
 * Plans the resize of a freehand stroke: its inked box (`freehandLocalBounds`) scaled
 * along the stroke's own axes about the box's top-left corner, as a group's box is. The points
 * scale by the new size over the old and the stroke's origin moves so the corner stays (or goes
 * to `origin`); the stroke width does not change, as a path's does not, so the new inked box is
 * the scaled centre line grown by the width. A side of zero length cannot grow, and a side with
 * length cannot collapse (`invalid-input`).
 *
 * @param context - The board before the command.
 * @param frames - The resized objects and their ancestors, for the origin's frame.
 * @param named - The stroke, its entry and the entry's path.
 * @returns The patch, or the errors.
 */
export function planFreehandEntry(
  context: CommandContext,
  frames: Board,
  named: FreehandResizeItem,
): FreehandEntryPlan {
  const { object, entry, path } = named;
  const corner =
    entry.origin === undefined ? undefined : boardToParentFrame(frames, object, entry.origin);
  if (corner === null) {
    const message = `the ancestors of "${object.id}" form a cycle`;
    return { patches: [], errors: [commandError('parent-cycle', object.id, path, message)] };
  }
  const bounds = freehandLocalBounds(object);
  const size =
    'to' in entry
      ? entry.to
      : { width: bounds.width + entry.by.width, height: bounds.height + entry.by.height };
  const isScalable = (before: number, after: number): boolean =>
    before > 0 ? after > 0 : after === 0;
  if (!isScalable(bounds.width, size.width) || !isScalable(bounds.height, size.height)) {
    const message = `a stroke's box cannot be collapsed, and a side of zero length cannot grow`;
    const field = 'to' in entry ? 'to' : 'by';
    return {
      patches: [],
      errors: [commandError('invalid-input', object.id, [...path, field], message)],
    };
  }
  const scaleX = bounds.width > 0 ? size.width / bounds.width : 1;
  const scaleY = bounds.height > 0 ? size.height / bounds.height : 1;
  const points = object.points.map((value, index) => value * (index % 2 === 0 ? scaleX : scaleY));
  // The box's corner, in the parent's frame, before and after the points scale about the origin.
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  const turn = (x: number, y: number): Point => ({ x: cos * x - sin * y, y: sin * x + cos * y });
  const before = turn(bounds.x, bounds.y);
  const half = object.stroke.width / 2;
  const after = turn((bounds.x + half) * scaleX - half, (bounds.y + half) * scaleY - half);
  const target = corner ?? { x: object.x + before.x, y: object.y + before.y };
  const patch = finiteGeometry({ x: target.x - after.x, y: target.y - after.y, points });
  const errors: CommandError[] = [];
  const checked = checkObject(context.board, { ...object, ...patch }, errors);
  return { patches: checked === undefined ? [] : [{ id: object.id, patch }], errors };
}
