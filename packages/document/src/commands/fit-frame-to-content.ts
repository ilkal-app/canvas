import { z } from 'zod';

import {
  applyTransform,
  buildChildIndex,
  finiteCoordinate,
  localBounds,
  objectIdSchema,
  placementTransform,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import { checkObject, movabilityErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { SubBoard } from './sub-board.js';

/** The space a fitted section keeps round its content, world units, unless the input names one. */
export const FIT_FRAME_PADDING = 40;

/**
 * How far, world units, a section may be from its fitted box and still count as fitted: turning
 * a child's corners into the section's coordinates and back leaves rounding error behind.
 */
const FITTED_TOLERANCE = 1e-6;

/** Validates `fitFrameToContent`'s input. */
export const fitFrameToContentInputSchema = z
  .strictObject({
    /** The section (frame) to fit. */
    id: objectIdSchema.describe('The section (frame) to fit.'),
    /** The space kept round the content, world units; 40 when omitted. */
    padding: z
      .number()
      .min(0)
      .max(1000)
      .optional()
      .describe('The space kept round the content, world units; 40 when omitted.'),
  })
  .describe("Fits a section to its content: its box hugs its children's, padded.");

/** What `fitFrameToContent` writes: the frame's box and its direct children's offsets. */
export interface FitFrameToContentPlan {
  /** The frame and each direct child, moved; none when the frame already fits. */
  readonly patches: readonly PlannedPatch[];
}

/** What `fitFrameToContent` did. */
export interface FitFrameToContentResult {
  /** The objects written: the frame and its direct children, or none. */
  readonly ids: readonly ObjectId[];
}

/** A rectangle by its edges, in the frame's own coordinates. */
interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The bounds of a frame's direct children in the frame's own coordinates: each child's local box
 * by its corners, turned with the child; connectors and comments do not count (a connector's ends
 * follow what it joins, a comment pins to a point), hidden children do.
 *
 * @param board - The board before the command.
 * @param frame - The frame.
 * @param children - Its direct children.
 * @returns The edges, or undefined when no child counts.
 */
function contentEdges(
  board: BoardReader,
  frame: BoardObject,
  children: readonly BoardObject[],
): Edges | undefined {
  const subBoard = new SubBoard(board);
  subBoard.addSubtree(frame.id);
  const subtrees = subBoard.toBoard();
  const index = buildChildIndex(subtrees);
  const points: Point[] = children
    .filter((child) => child.type !== 'connector' && child.type !== 'comment')
    .flatMap((child) => {
      const rect = localBounds(subtrees, child, index);
      const toFrame = placementTransform(child.x, child.y, child.rotation);
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      return [
        { x: rect.x, y: rect.y },
        { x: right, y: rect.y },
        { x: right, y: bottom },
        { x: rect.x, y: bottom },
      ].map((corner) => applyTransform(toFrame, corner));
    });
  if (points.length === 0) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: finiteCoordinate(Math.min(...xs)),
    top: finiteCoordinate(Math.min(...ys)),
    right: finiteCoordinate(Math.max(...xs)),
    bottom: finiteCoordinate(Math.max(...ys)),
  };
}

/**
 * Finds the frame a `fitFrameToContent` names and why it cannot be fitted, if it cannot.
 *
 * @param board - The board before the command.
 * @param id - The named object.
 * @returns The frame, or the errors.
 */
function fittableFrame(
  board: BoardReader,
  id: ObjectId,
): { readonly frame: BoardObject } | { readonly errors: CommandError[] } {
  const frame = board.get(id);
  if (frame === undefined) {
    return { errors: [commandError('missing-object', id, ['id'], `there is no object "${id}"`)] };
  }
  if (frame.type !== 'frame') {
    return { errors: [commandError('invalid-input', id, ['id'], `"${id}" is not a section`)] };
  }
  const locked = movabilityErrors(board, frame, ['id'], new Set([id]));
  if (locked.length > 0) return { errors: locked };
  if (frame.autoLayout !== undefined) {
    const message = `"${id}" has auto layout, which sizes it`;
    return { errors: [commandError('invalid-input', id, ['id'], message)] };
  }
  return { frame };
}

/**
 * `fitFrameToContent` (the section popover's Fit to content): a section's box becomes
 * its direct children's bounds grown by the padding, in its own (turned) coordinates, and nothing
 * moves on the board: the frame's origin moves with its rotation and every direct child shifts
 * the other way (grandchildren keep their place in their own parents). A locked child does not
 * stop it, as its place on the board stays. Refused for a missing object, a non-frame, a locked
 * frame, a frame with auto layout (it sizes itself) and a frame with nothing that counts. One
 * transaction, so one undo step; a frame that already fits writes nothing.
 */
export const fitFrameToContentCommand: Command<
  typeof fitFrameToContentInputSchema,
  FitFrameToContentPlan,
  FitFrameToContentResult
> = {
  name: 'fitFrameToContent',
  description: "Fits a section to its content: its box hugs its children's, padded.",
  input: fitFrameToContentInputSchema,
  validate(context, input) {
    const { board } = context;
    const found = fittableFrame(board, input.id);
    if ('errors' in found) return reject(found.errors);
    const { frame } = found;
    const children = [...board.references.childrenOf(frame.id)].flatMap(
      (childId) => board.get(childId) ?? [],
    );
    const edges = contentEdges(board, frame, children);
    if (edges === undefined || !('width' in frame)) {
      const message = `"${frame.id}" has nothing to fit`;
      return reject([commandError('invalid-input', frame.id, ['id'], message)]);
    }
    const padding = input.padding ?? FIT_FRAME_PADDING;
    const left = edges.left - padding;
    const top = edges.top - padding;
    const width = edges.right - edges.left + 2 * padding;
    const height = edges.bottom - edges.top + 2 * padding;
    const isFitted = [left, top, width - frame.width, height - frame.height].every(
      (offset) => Math.abs(offset) <= FITTED_TOLERANCE,
    );
    if (isFitted) {
      return accept({ patches: [] });
    }
    const origin = applyTransform(placementTransform(frame.x, frame.y, frame.rotation), {
      x: left,
      y: top,
    });
    const errors: CommandError[] = [];
    const moved = checkObject(board, { ...frame, x: origin.x, y: origin.y, width, height }, errors);
    const patches: PlannedPatch[] = [
      { id: frame.id, patch: { x: origin.x, y: origin.y, width, height } },
    ];
    for (const child of children) {
      const x = finiteCoordinate(child.x - left);
      const y = finiteCoordinate(child.y - top);
      checkObject(board, { ...child, x, y }, errors);
      patches.push({ id: child.id, patch: { x, y } });
    }
    if (moved === undefined || errors.length > 0) return reject(errors);
    return accept({ patches });
  },
  apply(transaction, input, plan) {
    return { ids: applyPatches(transaction, plan.patches) };
  },
};
