import { z } from 'zod';

import {
  constrainChildren,
  INSTANCE_SCALE_MAX,
  INSTANCE_SCALE_MIN,
  objectIdSchema,
  pointSchema,
  variantSizedAxes,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import type { ObjectPatch } from '../store/document-store.js';
import { findUnscalableSizeIssues } from '../store/door-values.js';

import { checkObject, lookUpNamed, movabilityErrors, type NamedObject } from './command-checks.js';
import { commandError, errorsFromIssues, type CommandError } from './command-error.js';
import { accept, reject, type Command, type CommandContext } from './command.js';
import { finiteGeometry } from './finite-geometry.js';
import { planGroupResize } from './group-resize.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { planFreehandEntry } from './resize-freehand.js';
import { planScaleEntry } from './resize-scale.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame } from './world-frame.js';

/** Where the resized object's box's top-left corner goes, for resizing from a top or left handle. */
const originField = pointSchema
  .optional()
  .describe(
    "Where the box's top-left corner goes (a boxed object's local origin, a group's derived box's corner), world units in the board's frame; omit to keep it.",
  );

/** Validates one resize: to a size, or by a change of size, in world units. */
const resizeSchema = z.union([
  z.strictObject({
    /** The object to resize. */
    id: objectIdSchema,
    /** The new size, world units. */
    to: z
      .strictObject({
        /** The new width, world units, at least 0. */
        width: z.number().nonnegative().describe('The new width, world units, at least 0.'),
        /** The new height, world units, at least 0. */
        height: z.number().nonnegative().describe('The new height, world units, at least 0.'),
      })
      .describe('The new size, world units.'),
    /** Where the box's top-left corner goes; omit to keep it. */
    origin: originField,
  }),
  z.strictObject({
    /** The object to resize. */
    id: objectIdSchema,
    /** The change of size, world units; the result must not be negative. */
    by: z
      .strictObject({
        /** The change of width, world units. */
        width: z.number().describe('The change of width, world units.'),
        /** The change of height, world units. */
        height: z.number().describe('The change of height, world units.'),
      })
      .describe('The change of size, world units; the result must not be negative.'),
    /** Where the box's top-left corner goes; omit to keep it. */
    origin: originField,
  }),
  z.strictObject({
    /** The instance whose content scale to set. */
    id: objectIdSchema,
    /** The new content scale, absolute; the box grows or shrinks with it. */
    scale: z
      .number()
      .min(INSTANCE_SCALE_MIN)
      .max(INSTANCE_SCALE_MAX)
      .describe(
        "An instance's new content scale, 0.05 to 20 (1 is its main's size); its box grows or shrinks by the new scale over the old.",
      ),
    /** Where the box's top-left corner goes; omit to keep it. */
    origin: originField,
  }),
]);

/** Validates the input of {@link resizeObjectsCommand}. */
export const resizeObjectsInputSchema = z
  .strictObject({
    /** One resize per object. */
    resizes: z.array(resizeSchema).min(1).describe('One resize per object.'),
  })
  .describe(
    "Resizes boxed objects and groups to a size or by a change of size, in world units, or sets an instance's content scale.",
  );

/** What {@link resizeObjectsCommand} will write. */
export interface ResizeObjectsPlan {
  /** The patches: the resized objects' and, for a group, its descendants'. */
  readonly patches: readonly PlannedPatch[];
  /** The objects named, in input order. */
  readonly resizedIds: readonly ObjectId[];
}

/** What {@link resizeObjectsCommand} returns. */
export interface ResizeObjectsResult {
  /** The objects resized, in input order. */
  readonly resizedIds: readonly ObjectId[];
}

/** One resize entry as the input schema gives it. */
type AnyResizeEntry = z.output<typeof resizeSchema>;

/** A resize to a size or by a change of size: every arm but an instance's scale. */
type ResizeEntry = Exclude<AnyResizeEntry, { readonly scale: number }>;

/** What one resize writes: patches, or the errors that refuse it. */
interface EntryPlan {
  /** The patches. */
  readonly patches: readonly PlannedPatch[];
  /** The errors. */
  readonly errors: readonly CommandError[];
}

/**
 * Plans the resize of a boxed object: its size and, with an `origin`, its position.
 *
 * @param context - The board before the command.
 * @param frames - The resized objects and their ancestors, for the origin's frame.
 * @param named - The object, its entry and the entry's path.
 * @returns The patch, or the errors.
 */
function planBoxedEntry(
  context: CommandContext,
  frames: Board,
  named: NamedObject<ResizeEntry> & {
    readonly object: { readonly width: number; readonly height: number };
  },
): EntryPlan {
  const { object, entry, path } = named;
  const size =
    'to' in entry
      ? entry.to
      : { width: object.width + entry.by.width, height: object.height + entry.by.height };
  const position =
    entry.origin === undefined
      ? { x: object.x, y: object.y }
      : boardToParentFrame(frames, object, entry.origin);
  if (position === null) {
    const message = `the ancestors of "${object.id}" form a cycle`;
    return { patches: [], errors: [commandError('parent-cycle', object.id, path, message)] };
  }
  const patch = { ...size, ...position, ...fixedSizing(context, object, size) };
  const errors: CommandError[] = [];
  const checked = checkObject(context.board, { ...object, ...patch }, errors);
  const patches: PlannedPatch[] = checked === undefined ? [] : [{ id: object.id, patch }];
  // An auto-layout container's children are placed by its layout (`planRelayout`), not by their
  // constraints.
  if (
    checked !== undefined &&
    (object.type === 'frame' || object.type === 'component') &&
    object.autoLayout === undefined
  ) {
    const subtree = new SubBoard(context.board);
    subtree.addSubtree(object.id);
    const before = subtree.toBoard();
    for (const child of constrainChildren(before, object, size)) {
      const stored = context.board.get(child.id);
      const childPatch = groupResizePatch(child);
      if (
        stored === undefined ||
        JSON.stringify(groupResizePatch(stored)) === JSON.stringify(childPatch)
      )
        continue;
      if (stored.locked) {
        errors.push(commandError('locked', child.id, path, 'A constrained child is locked.'));
        continue;
      }
      checkObject(context.board, child, errors);
      patches.push({ id: child.id, patch: childPatch });
    }
  }
  return { patches, errors };
}

/**
 * What resizing an object fixes of its auto-layout sizing: a frame or main whose
 * auto-layout hugs an axis the resize changes keeps the new size, so that axis becomes `fixed`;
 * an instance whose main hugs an axis the resize changes keeps its own size on that axis
 * (`isWidthFixed`, `isHeightFixed`;), as does one on an axis its main's
 * variants size (`variantSizedAxes`). Nothing for an axis left unchanged.
 *
 * @param context - The board before the command.
 * @param object - The object resized.
 * @param size - Its new size.
 * @param size.width - The new width.
 * @param size.height - The new height.
 * @returns The fields to write with the size; empty when none.
 */
function fixedSizing(
  context: CommandContext,
  object: BoardObject & { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number },
): Record<string, unknown> {
  const isWidthChanged = size.width !== object.width;
  const isHeightChanged = size.height !== object.height;
  if (object.type === 'frame' || object.type === 'component') {
    const layout = object.autoLayout;
    if (layout === undefined) return {};
    const width = isWidthChanged ? 'fixed' : layout.width;
    const height = isHeightChanged ? 'fixed' : layout.height;
    return width === layout.width && height === layout.height
      ? {}
      : { autoLayout: { ...layout, width, height } };
  }
  if (object.type !== 'instance') return {};
  const main = context.board.get(object.mainId);
  if (main?.type !== 'component') return {};
  const layout = main.autoLayout;
  // An axis the main's variants size is sized like a hug axis: a resize keeps it.
  const sized = variantSizedAxes(main);
  const isWidthKept = layout?.width === 'hug' || sized.isWidthSized;
  const isHeightKept = layout?.height === 'hug' || sized.isHeightSized;
  return {
    ...(isWidthChanged && isWidthKept ? { isWidthFixed: true } : {}),
    ...(isHeightChanged && isHeightKept ? { isHeightFixed: true } : {}),
  };
}

/**
 * The fields a group resize writes on one object: its position, and whatever stored geometry
 * the resize scales (a box's size, a line's points, a path's network, free connector ends).
 *
 * @param object - The object as the resize leaves it.
 * @returns The patch.
 */
function groupResizePatch(object: BoardObject): ObjectPatch {
  const position = { x: object.x, y: object.y };
  switch (object.type) {
    case 'line':
      return { ...position, points: object.points };
    case 'path':
      return { ...position, vertices: object.vertices, segments: object.segments };
    case 'freehand':
      return { ...position, points: object.points };
    case 'connector':
      return { ...position, from: object.from, to: object.to };
    default:
      return 'width' in object
        ? { ...position, width: object.width, height: object.height }
        : position;
  }
}

/**
 * Plans the resize of a group: its derived box scaled along its own axes
 * (`planGroupResize`), every descendant rewritten in its own parent's frame.
 *
 * @param context - The board before the command.
 * @param frames - The resized objects and their ancestors, for the origin's frame.
 * @param named - The group, its entry and the entry's path.
 * @returns The patches, or the errors.
 */
function planGroupEntry(
  context: CommandContext,
  frames: Board,
  named: NamedObject<ResizeEntry>,
): EntryPlan {
  const { object, entry, path } = named;
  const corner =
    entry.origin === undefined ? undefined : boardToParentFrame(frames, object, entry.origin);
  if (corner === null) {
    const message = `the ancestors of "${object.id}" form a cycle`;
    return { patches: [], errors: [commandError('parent-cycle', object.id, path, message)] };
  }
  const { board } = context;
  const tree = {
    get: (id: ObjectId) => board.get(id),
    childrenOf: (id: ObjectId) => board.references.childrenOf(id),
  };
  const change = 'to' in entry ? { to: entry.to } : { by: entry.by };
  const plan = planGroupResize(tree, object, corner === undefined ? change : { ...change, corner });
  // The resize scales every size the group holds, and one that is not finite (a peer's)
  // leaves the group's box unscalable: named first, as the size it derives from. A finite size
  // past the door's range can be scaled into it; the result is judged below (`checkObject`).
  const sizeErrors = plan.objects.flatMap(({ id }) => {
    const stored = board.get(id);
    return stored === undefined
      ? []
      : errorsFromIssues('invalid-object', stored.id, findUnscalableSizeIssues(stored));
  });
  if (sizeErrors.length > 0) return { patches: [], errors: sizeErrors };
  // A side with length can only scale to another length (0 would collapse every descendant
  // onto a line for good), and a side of zero length cannot scale at all.
  const isScalable = (before: number, after: number): boolean =>
    before > 0 ? after > 0 : after === 0;
  if (
    !isScalable(plan.before.width, plan.size.width) ||
    !isScalable(plan.before.height, plan.size.height)
  ) {
    const message = `a group's box cannot be collapsed, and a side of zero length cannot grow`;
    const field = 'to' in entry ? 'to' : 'by';
    return {
      patches: [],
      errors: [commandError('invalid-input', object.id, [...path, field], message)],
    };
  }
  const errors: CommandError[] = [];
  const patches = plan.objects.flatMap((resized) => {
    const patch = finiteGeometry(groupResizePatch(resized));
    const stored = board.get(resized.id);
    return checkObject(board, { ...stored, ...patch }, errors) === undefined
      ? []
      : [{ id: resized.id, patch }];
  });
  return { patches, errors };
}

/**
 * `resizeObjects`: sets the stored box of text, stickies, images,
 * videos, shapes, frames and instances, to a size or by a change of size in world units (an
 * object's own units are world units; an instance's content scale is its own arm, below), and
 * resizes groups by scaling what they
 * hold: a group's box is derived, so the size given is its derived box's, and
 * every descendant is rewritten (`planGroupResize`: boxed objects stretch along the group's
 * axes and move with it, line points and path vertices scale, font sizes do not change). An
 * optional `origin` in board coordinates moves the box's top-left corner too, as resizing from
 * a top or left handle does, in the same transaction. A frame's children keep their positions.
 * A freehand stroke scales its points to its inked box's new size (`planFreehandEntry`).
 * Lines, paths, connectors and comments have no box and are refused, as are locked objects,
 * groups holding a locked object, objects listed with a group above them (the group's resize
 * rewrites them), and a group resize that would collapse its box along a side or grow a side
 * of zero length (`invalid-input`). A `scale` sets an instance's content scale (
 * `planScaleEntry`): its box grows or shrinks with it; any other type is refused.
 */
export const resizeObjectsCommand: Command<
  typeof resizeObjectsInputSchema,
  ResizeObjectsPlan,
  ResizeObjectsResult
> = {
  name: 'resizeObjects',
  description:
    "Resizes boxed objects and groups to a size or by a change of size, in world units, or sets an instance's content scale.",
  input: resizeObjectsInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.resizes,
      (resize) => resize.id,
      (index) => ['resizes', index],
    );
    const movedIds = new Set(
      named.filter(({ entry }) => entry.origin !== undefined).map(({ object }) => object.id),
    );
    const groupIds = new Set(
      named.filter(({ object }) => object.type === 'group').map(({ object }) => object.id),
    );
    // Built once: rebuilding it per entry made a release of N resizes O(N²).
    const movedOrGroupIds = new Set([...movedIds, ...groupIds]);
    const subBoard = new SubBoard(board);
    for (const { object } of named) subBoard.addWithAncestors(object.id);
    const frames = subBoard.toBoard();
    const patches: PlannedPatch[] = [];
    for (const item of named) {
      const { object, entry, path } = item;
      const listedIds = entry.origin === undefined ? groupIds : movedOrGroupIds;
      errors.push(...movabilityErrors(board, object, path, listedIds));
      let plan: EntryPlan;
      if ('scale' in entry) plan = planScaleEntry(context, frames, { ...item, entry });
      else if (object.type === 'group') plan = planGroupEntry(context, frames, { ...item, entry });
      else if (object.type === 'freehand') {
        plan = planFreehandEntry(context, frames, { ...item, entry, object });
      }
      // Exactly the boxed types (text, sticky, image, video, shape, frame) store a width.
      else if ('width' in object)
        plan = planBoxedEntry(context, frames, { ...item, entry, object });
      else {
        const message = `a ${object.type} has no stored size`;
        errors.push(commandError('unsupported-type', object.id, path, message));
        continue;
      }
      errors.push(...plan.errors);
      patches.push(...plan.patches);
    }
    const resizedIds = named.map(({ object }) => object.id);
    return errors.length > 0 ? reject(errors) : accept({ patches, resizedIds });
  },
  apply(transaction, input, plan) {
    applyPatches(transaction, plan.patches);
    return { resizedIds: plan.resizedIds };
  },
};
