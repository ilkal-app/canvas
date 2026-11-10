import { z } from 'zod';

import { objectIdSchema, pointSchema, type ObjectId, type Point } from '@canvas/schema';

import { checkObject, lookUpNamed, movabilityErrors } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { normalizeAngle } from './normalize-angle.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame, isFarPlaced, parentFrameToBoard } from './world-frame.js';

/** Validates one rotation: by an angle, about a board point or the object's own origin. */
const rotationSchema = z.strictObject({
  /** The object to turn. */
  id: objectIdSchema,
  /** The angle, radians, clockwise on screen. */
  by: z.number().describe('The angle to turn by, radians, clockwise on screen (y points down).'),
  /** The fixed point of the turn, board coordinates; the object's local origin if omitted. */
  about: pointSchema
    .optional()
    .describe(
      "The point the object turns about, world units in the board's frame; omit to turn it about its own local origin.",
    ),
});

/** Validates the input of {@link rotateObjectsCommand}. */
export const rotateObjectsInputSchema = z
  .strictObject({
    /** One rotation per object. */
    rotations: z.array(rotationSchema).min(1).describe('One rotation per object.'),
  })
  .describe('Turns objects by an angle about a point, in board coordinates.');

/** What {@link rotateObjectsCommand} returns. */
export interface RotateObjectsResult {
  /** The objects turned, in input order. */
  readonly rotatedIds: readonly ObjectId[];
}

/**
 * Turns a point about a pivot, clockwise on screen.
 *
 * @param point - The point.
 * @param pivot - The fixed point.
 * @param angle - The angle, radians.
 * @returns The turned point.
 */
function rotateAbout(point: Point, pivot: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: pivot.x + cos * dx - sin * dy, y: pivot.y + sin * dx + cos * dy };
}

/**
 * `rotateObjects`: turns objects by an angle about a point
 * given in board coordinates, or about each object's own local origin. The object's rotation
 * grows by the angle (kept in (−π, π]) and its local origin turns about the pivot, converted
 * into its parent's frame, so an object in a rotated group turns the way it looks on
 * screen, and several objects turned about one pivot turn as one rigid selection. Children are
 * relative to their parent and turn with it without being rewritten. Refused for a locked
 * object and for an object listed together with one of its ancestors.
 */
export const rotateObjectsCommand: Command<
  typeof rotateObjectsInputSchema,
  readonly PlannedPatch[],
  RotateObjectsResult
> = {
  name: 'rotateObjects',
  description: 'Turns objects by an angle about a point, in board coordinates.',
  input: rotateObjectsInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.rotations,
      (rotation) => rotation.id,
      (index) => ['rotations', index],
    );
    const ids = new Set(named.map(({ object }) => object.id));
    const subBoard = new SubBoard(board);
    for (const { object } of named) subBoard.addWithAncestors(object.id);
    const frames = subBoard.toBoard();
    const patches: PlannedPatch[] = [];
    for (const { object, entry, path } of named) {
      errors.push(...movabilityErrors(board, object, path, ids));
      // Turned about its own origin placed far away (itself or through an ancestor), an object does not move;
      // the round trip through the board frame would cancel its position away.
      const isStaying = entry.about === undefined && isFarPlaced(frames, object);
      const origin = parentFrameToBoard(frames, object, { x: object.x, y: object.y });
      const position = isStaying
        ? { x: object.x, y: object.y }
        : origin === null
          ? null
          : boardToParentFrame(
              frames,
              object,
              rotateAbout(origin, entry.about ?? origin, entry.by),
            );
      if (position === null) {
        const message = `the ancestors of "${object.id}" form a cycle`;
        errors.push(commandError('parent-cycle', object.id, path, message));
        continue;
      }
      const patch = { ...position, rotation: normalizeAngle(object.rotation + entry.by) };
      if (checkObject(context.board, { ...object, ...patch }, errors) !== undefined) {
        patches.push({ id: object.id, patch });
      }
    }
    return errors.length > 0 ? reject(errors) : accept(patches);
  },
  apply(transaction, input, plan) {
    return { rotatedIds: applyPatches(transaction, plan) };
  },
};
