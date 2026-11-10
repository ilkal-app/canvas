import { z } from 'zod';

import {
  applyTransform,
  finiteCoordinate,
  invertTransform,
  objectIdSchema,
  objectToBoardTransform,
  pointSchema,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { SubBoard } from './sub-board.js';
import { unlessParentCycle } from './world-frame.js';

/** Validates the input of {@link setLinePointsCommand}. */
export const setLinePointsInputSchema = z
  .strictObject({
    /** The line whose end moves. */
    id: objectIdSchema,
    /** Which end moves: 0 the line's start, 1 its end. */
    end: z
      .union([z.literal(0), z.literal(1)])
      .describe("Which end moves: 0 the line's start (its first point), 1 its end."),
    /** Where that end goes, in board coordinates. */
    point: pointSchema.describe("The end's new position, world units in the board's frame."),
  })
  .describe('Moves one end of a line to a board position; the other end stays where it is.');

/** What {@link setLinePointsCommand} will write: the line's points in its own frame. */
export interface SetLinePointsPlan {
  /** The line. */
  readonly id: ObjectId;
  /**
   * Its new points in its own frame, the moved end with the stored other end; `null` when the
   * moved end is already there (nothing written).
   */
  readonly points: readonly [Point, Point] | null;
}

/** What {@link setLinePointsCommand} returns. */
export interface SetLinePointsResult {
  /** The line, when its end moved; empty when the end was already there. */
  readonly changedIds: readonly ObjectId[];
}

/** The `setLinePoints` command's type. */
export type SetLinePointsCommand = Command<
  typeof setLinePointsInputSchema,
  SetLinePointsPlan,
  SetLinePointsResult
>;

/**
 * Whether two points are equal.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns True when both coordinates are.
 */
function isSamePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** How close, in world units, two ends may come before the line counts as having no length. */
const ZERO_LENGTH_TOLERANCE = 1e-6;

/**
 * `setLinePoints`: moves one end of a line
 * to a position given in board coordinates, converted into the line's own frame (a line's
 * points are relative to its origin and turned with it), so an end dragged inside a rotated
 * group lands where the pointer put it. The other end is read from the stored line when the
 * command runs, so a move or an end drag a collaborator made meanwhile is kept. Only the moved
 * end is written: each end is its own key in the grouped layout (`codec/pair-codec.ts`), so an
 * end drag merges with a concurrent move (placement), restyle (style) or drag of the other end,
 * and undoing it leaves the other end to whoever last moved it; two concurrent drags of the same
 * end keep one (last writer wins). The line keeps its origin and rotation. Refused for anything
 * but a line (`unsupported-type`), for a locked line (`locked`), as a move is, and for an
 * end put on the other end (`invalid-input`: a line needs a length); an end that is already
 * there writes nothing.
 */
export const setLinePointsCommand: SetLinePointsCommand = {
  name: 'setLinePoints',
  description:
    'Moves one end of a line to a position in board coordinates; the other end stays. Refused for a locked line, or when the two ends would meet.',
  input: setLinePointsInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      [input.id],
      (id) => id,
      () => ['id'],
    );
    const [found] = named;
    if (!found) return reject(errors);
    const { object } = found;
    const problems: CommandError[] = [];
    if (object.type !== 'line') {
      const message = `"${object.id}" is a ${object.type}, not a line`;
      problems.push(commandError('unsupported-type', object.id, ['id'], message));
    }
    if (object.locked) {
      problems.push(commandError('locked', object.id, ['id'], `"${object.id}" is locked`));
    }
    if (problems.length > 0 || object.type !== 'line') return reject(problems);
    const subBoard = new SubBoard(board);
    subBoard.addWithAncestors(object.id);
    const frames = subBoard.toBoard();
    const toBoard = unlessParentCycle(() => objectToBoardTransform(frames, object));
    if (toBoard === null) {
      const message = `the ancestors of "${object.id}" form a cycle`;
      return reject([commandError('parent-cycle', object.id, ['id'], message)]);
    }
    const other = applyTransform(toBoard, object.points[input.end === 0 ? 1 : 0]);
    const gap = Math.hypot(input.point.x - other.x, input.point.y - other.y);
    if (gap <= ZERO_LENGTH_TOLERANCE) {
      const message = `the two ends of "${object.id}" would meet: a line needs a length`;
      return reject([commandError('invalid-input', object.id, ['point'], message)]);
    }
    const placed = applyTransform(invertTransform(toBoard), input.point);
    // A line stored far away can overflow the frame change; only what is not finite is clamped.
    const moved = { x: finiteCoordinate(placed.x), y: finiteCoordinate(placed.y) };
    if (isSamePoint(moved, object.points[input.end]))
      return accept({ id: object.id, points: null });
    const points: [Point, Point] =
      input.end === 0 ? [moved, object.points[1]] : [object.points[0], moved];
    const invalid: CommandError[] = [];
    checkObject(board, { ...object, points }, invalid);
    if (invalid.length > 0) return reject(invalid);
    return accept({ id: object.id, points });
  },
  apply(transaction, input, plan) {
    if (plan.points === null) return { changedIds: [] };
    // The codec writes only the end whose value changed: the other is the stored one.
    transaction.patchObject(plan.id, { points: [...plan.points] });
    return { changedIds: [plan.id] };
  },
};
