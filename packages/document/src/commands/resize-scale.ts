import type { Board, Point } from '@canvas/schema';

import { checkObject, type NamedObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import type { CommandContext } from './command.js';
import type { PlannedPatch } from './object-patches.js';
import { boardToParentFrame } from './world-frame.js';

/** A resize that sets an instance's content scale, as the input schema gives it. */
export interface ScaleResizeEntry {
  /** The instance. */
  readonly id: string;
  /** Its new content scale, absolute, in the schema's range. */
  readonly scale: number;
  /** Where the box's top-left corner goes; omit to keep it. */
  readonly origin?: Point | undefined;
}

/** What one scale resize writes: patches, or the errors that refuse it. */
export interface ScaleEntryPlan {
  /** The patches. */
  readonly patches: readonly PlannedPatch[];
  /** The errors. */
  readonly errors: readonly CommandError[];
}

/**
 * Plans a resize that sets an instance's content scale: the instance stores the new
 * scale (none at 1, which is what absent means) and its box grows or shrinks by the new scale
 * over the old, so its content keeps its layout and only draws larger or smaller. With an
 * `origin`, the box's top-left corner moves too. The fixed-axis flags are left as they are: the
 * box follows the content, so no axis is fixed by it. Anything but an instance is refused
 * (`unsupported-type`): only an instance has content drawn at a scale.
 *
 * @param context - The board before the command.
 * @param frames - The resized objects and their ancestors, for the origin's frame.
 * @param named - The object, its entry and the entry's path.
 * @returns The patch, or the errors.
 */
export function planScaleEntry(
  context: CommandContext,
  frames: Board,
  named: NamedObject<ScaleResizeEntry>,
): ScaleEntryPlan {
  const { object, entry, path } = named;
  if (object.type !== 'instance') {
    const message = `a ${object.type} has no content scale; only an instance does`;
    return { patches: [], errors: [commandError('unsupported-type', object.id, path, message)] };
  }
  const position =
    entry.origin === undefined
      ? { x: object.x, y: object.y }
      : boardToParentFrame(frames, object, entry.origin);
  if (position === null) {
    const message = `the ancestors of "${object.id}" form a cycle`;
    return { patches: [], errors: [commandError('parent-cycle', object.id, path, message)] };
  }
  const { scale: previous = 1, ...unscaled } = object;
  const ratio = entry.scale / previous;
  const box = { ...position, width: object.width * ratio, height: object.height * ratio };
  const isUnit = entry.scale === 1;
  const after = isUnit ? { ...unscaled, ...box } : { ...unscaled, ...box, scale: entry.scale };
  const errors: CommandError[] = [];
  const checked = checkObject(context.board, after, errors);
  // Writing `undefined` removes the stored scale: absent is 1.
  const patch = { ...box, scale: isUnit ? undefined : entry.scale };
  return { patches: checked === undefined ? [] : [{ id: object.id, patch }], errors };
}
