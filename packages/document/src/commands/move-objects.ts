import { z } from 'zod';

import {
  objectIdSchema,
  pointSchema,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import { checkObject, lookUpNamed, movabilityErrors } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { planReparents, type ReparentRequest } from './reparent.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame, canHoldPoint, movedByInParentFrame } from './world-frame.js';

/** Validates the optional new parent of a move. */
const newParentSchema = objectIdSchema
  .nullable()
  .optional()
  .describe(
    'The frame the object ends up in, or null for the board root; omitted keeps its parent. The object stays where the move puts it on the board.',
  );

/**
 * What a move that is neither form is told: both forms, with an example, so an agent
 * that wrote `dx`/`dy` need not guess.
 */
const MOVE_FORMS =
  'a move is { id, by: { x, y } } (a delta; or { id, dx, dy }) or { id, to: { x, y } } (a board position), e.g. { id, by: { x: -21, y: 0 } }';

/** A move by a delta, world units in the board's frame. */
export interface MoveBy {
  /** The object to move. */
  readonly id: ObjectId;
  /** The displacement. */
  readonly by: Point;
  /** The frame the object ends up in, `null` for the root; omitted keeps its parent. */
  readonly parentId?: ObjectId | null | undefined;
}

/** A move to a position, world units in the board's frame. */
export interface MoveTo {
  /** The object to move. */
  readonly id: ObjectId;
  /** Where the object's local origin goes. */
  readonly to: Point;
  /** The frame the object ends up in, `null` for the root; omitted keeps its parent. */
  readonly parentId?: ObjectId | null | undefined;
}

/**
 * Validates one move: by a delta, or to a position, both in board coordinates. Its fields are read
 * as one object, so a bad value is told at its own path (`by.x`); an unknown key, or
 * neither form or more than one, is told the two forms with an example ({@link MOVE_FORMS}).
 * `dx`/`dy` are taken as `by`: agents write them first, and a refusal cost a call.
 */
const moveSchema = z
  .strictObject(
    {
      /** The object to move. */
      id: objectIdSchema,
      /** The displacement, world units in the board's frame; give this or `to`. */
      by: pointSchema
        .optional()
        .describe("The displacement, world units in the board's frame; give this or to."),
      /** Where the object's local origin goes, world units in the board's frame; or `by`. */
      to: pointSchema
        .optional()
        .describe(
          "Where the object's local origin goes, world units in the board's frame; give this or by.",
        ),
      /** The horizontal displacement, as `by.x`; with `dy`, instead of `by` or `to`. */
      dx: z.number().optional().describe('As by.x: dx and dy are read as by.'),
      /** The vertical displacement, as `by.y`; with `dx`, instead of `by` or `to`. */
      dy: z.number().optional().describe('As by.y: dx and dy are read as by.'),
      /** The frame the object ends up in, `null` for the root; omitted keeps its parent. */
      parentId: newParentSchema,
    },
    { error: (issue) => (issue.code === 'unrecognized_keys' ? MOVE_FORMS : undefined) },
  )
  .refine(
    ({ by, to, dx, dy }) => [by, to, dx ?? dy].filter((form) => form !== undefined).length === 1,
    { error: MOVE_FORMS },
  )
  // The check above leaves exactly one form. The move is rebuilt without the others' keys, so a
  // `to: undefined` written beside `by` cannot read as a to-move.
  .transform(({ by, to, dx, dy, ...rest }): MoveBy | MoveTo => {
    if (to !== undefined) return { ...rest, to };
    return { ...rest, by: by ?? { x: dx ?? 0, y: dy ?? 0 } };
  });

/** One move of {@link moveObjectsInputSchema}. */
type Move = z.output<typeof moveSchema>;

/**
 * Where a move puts an object's local origin, in its parent's frame.
 *
 * @param frames - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param move - The move.
 * @returns The new `x` and `y`, or `null` when the ancestors form a cycle.
 */
function newPosition(frames: Board, object: BoardObject, move: Move): Point | null {
  if ('to' in move) return boardToParentFrame(frames, object, move.to);
  return movedByInParentFrame(frames, object, move.by);
}

/** Validates the input of {@link moveObjectsCommand}. */
export const moveObjectsInputSchema = z
  .strictObject({
    /** One move per object. */
    moves: z.array(moveSchema).min(1).describe('One move per object.'),
  })
  .describe('Moves objects by a delta or to a position, in board coordinates.');

/** What {@link moveObjectsCommand} returns. */
export interface MoveObjectsResult {
  /** The objects moved, in input order. */
  readonly movedIds: readonly ObjectId[];
  /** The objects that changed parent, in input order; the others kept theirs. */
  readonly reparentedIds: readonly ObjectId[];
  /**
   * The objects among them moved `to` a board point their parent's frame could not hold (an
   * ancestor placed so far away that its numbers swallow the point, or not finite:), so
   * the move took them out of it, onto the root or into the frame it names, in input order.
   */
  readonly rerootedIds: readonly ObjectId[];
}

/** What {@link moveObjectsCommand} will write. */
export interface MoveObjectsPlan {
  /** Each object's new fields, in input order. */
  readonly patches: readonly PlannedPatch[];
  /** The objects that change parent, in input order. */
  readonly reparentedIds: readonly ObjectId[];
  /** The objects taken out of a parent that could not hold where they go, in input order. */
  readonly rerootedIds: readonly ObjectId[];
}

/**
 * The reparent a move `to` a board point needs when the object's parent frame cannot hold the
 * point (`canHoldPoint`): the object goes onto the root, or into the frame the move
 * names, placed at the point itself.
 *
 * @param frames - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param move - The move.
 * @param path - The move's input path.
 * @returns The reparent, or `undefined` when the parent can hold the point or it is a `by` move.
 */
function rerootOf(
  frames: Board,
  object: BoardObject,
  move: Move,
  path: readonly (string | number)[],
): ReparentRequest | undefined {
  if (!('to' in move) || canHoldPoint(frames, object, move.to)) return undefined;
  const asked = move.parentId ?? null;
  const parentId = asked === object.parentId ? null : asked;
  return { object, position: move.to, parentId, path, onBoard: move.to };
}

/**
 * `moveObjects`: moves objects by a displacement or to a position, given
 * in board coordinates and converted into each object's parent frame, so an object in a
 * rotated group moves the way it looks on screen. Only the object's `x` and `y` change: its
 * children are relative to it and move with it without being rewritten. Refused for a locked
 * object and for an object listed together with one of its ancestors, which would move
 * it twice.
 *
 * A move with a `parentId` other than the object's own also takes it into that frame, or onto
 * the root for `null`, in the same transaction, so the move and the
 * reparent are one undo step: its position and rotation are converted into the new parent's
 * frame, so it stays where the move puts it on the board, and it goes on top of its new
 * siblings, the objects taken into one parent keeping the order they stacked in. Refused when
 * the new parent is missing or not a frame, is the object or inside it, or is moved by the
 * same command, and for an object in a group, which moves with its group.
 *
 * A move `to` a board point that the object's parent frame cannot hold (an ancestor placed so far
 * away that its numbers swallow the point, or not finite, `canHoldPoint`) takes the
 * object out of that frame, out of a group too, onto the root or into the frame the move names,
 * so a person can always bring a far object back inside; the result names it (`rerootedIds`).
 */
export const moveObjectsCommand: Command<
  typeof moveObjectsInputSchema,
  MoveObjectsPlan,
  MoveObjectsResult
> = {
  name: 'moveObjects',
  description: 'Moves objects by a delta or to a position, in board coordinates.',
  input: moveObjectsInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.moves,
      (move) => move.id,
      (index) => ['moves', index],
    );
    const ids = new Set(named.map(({ object }) => object.id));
    const subBoard = new SubBoard(board);
    for (const { object } of named) subBoard.addWithAncestors(object.id);
    const frames = subBoard.toBoard();
    const positions: {
      readonly object: BoardObject;
      readonly patch: Point;
      readonly path: readonly (string | number)[];
    }[] = [];
    const requests: ReparentRequest[] = [];
    for (const { object, entry, path } of named) {
      errors.push(...movabilityErrors(board, object, path, ids));
      const reroot = rerootOf(frames, object, entry, path);
      if (reroot !== undefined) {
        positions.push({ object, patch: reroot.position, path });
        requests.push(reroot);
        continue;
      }
      const position = newPosition(frames, object, entry);
      if (position === null) {
        const message = `the ancestors of "${object.id}" form a cycle`;
        errors.push(commandError('parent-cycle', object.id, path, message));
      } else {
        positions.push({ object, patch: position, path });
        const { parentId } = entry;
        if (parentId !== undefined && parentId !== object.parentId) {
          requests.push({ object, position, parentId, path });
        }
      }
    }
    if (errors.length > 0) return reject(errors);
    const reparents = planReparents(board, requests, ids, errors);
    const patches = positions.flatMap(({ object, patch }) => {
      const merged = reparents.get(object.id) ?? patch;
      const checked = checkObject(board, { ...object, ...merged }, errors);
      return checked === undefined ? [] : [{ id: object.id, patch: merged }];
    });
    if (errors.length > 0) return reject(errors);
    return accept({
      patches,
      reparentedIds: requests.map(({ object }) => object.id),
      rerootedIds: requests.flatMap(({ object, onBoard }) => (onBoard ? [object.id] : [])),
    });
  },
  apply(transaction, input, plan) {
    return {
      movedIds: applyPatches(transaction, plan.patches),
      reparentedIds: plan.reparentedIds,
      rerootedIds: plan.rerootedIds,
    };
  },
};
