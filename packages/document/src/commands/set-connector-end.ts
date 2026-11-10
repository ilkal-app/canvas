import { z } from 'zod';

import {
  applyTransform,
  finiteCoordinate,
  invertTransform,
  objectIdSchema,
  objectToBoardTransform,
  pointSchema,
  unitPointSchema,
  type ConnectorEnd,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, lookUpNamed, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { SubBoard } from './sub-board.js';
import { unlessParentCycle } from './world-frame.js';

/** Validates where {@link setConnectorEndCommand} puts the end: an object, or a board point. */
const connectorEndTargetSchema = z.union([
  z.strictObject({
    /** The object the end attaches to. */
    objectId: objectIdSchema.describe('The object the end attaches to.'),
    /** Where on the object's bounds, as fractions of its size; null (default) picks a side. */
    anchor: unitPointSchema
      .nullable()
      .default(null)
      .describe(
        "Where on the object's bounds, as fractions of its size; null (default) picks a side.",
      ),
  }),
  z.strictObject({
    /** A free end, world units in the board's frame. */
    point: pointSchema.describe("A free end, world units in the board's frame."),
  }),
]);

/** Validates the input of {@link setConnectorEndCommand}. */
export const setConnectorEndInputSchema = z
  .strictObject({
    /** The connector whose end moves. */
    id: objectIdSchema.describe('The connector whose end moves.'),
    /** Which end: `from`, its start, or `to`, its end. */
    end: z.enum(['from', 'to']).describe('Which end: from, its start, or to, its end.'),
    /** Where the end goes: an object (with an anchor), or a point on the board. */
    target: connectorEndTargetSchema.describe(
      'Where the end goes: an object (with an anchor), or a point on the board.',
    ),
  })
  .describe(
    'Attaches one end of a connector to an object, or frees it at a board point; the other end stays.',
  );

/** What {@link setConnectorEndCommand} will write. */
export interface SetConnectorEndPlan {
  /** The connector. */
  readonly id: ObjectId;
  /** Which end. */
  readonly end: 'from' | 'to';
  /** The end as stored, in the connector's frame; `null` when it is already so (nothing written). */
  readonly value: ConnectorEnd | null;
}

/** What {@link setConnectorEndCommand} returns. */
export interface SetConnectorEndResult {
  /** The connector, when its end changed; empty when the end was already so. */
  readonly changedIds: readonly ObjectId[];
}

/** The `setConnectorEnd` command's type. */
export type SetConnectorEndCommand = Command<
  typeof setConnectorEndInputSchema,
  SetConnectorEndPlan,
  SetConnectorEndResult
>;

/**
 * Whether two stored ends are the same.
 *
 * @param a - One end.
 * @param b - The other.
 * @returns True when they attach to the same object at the same anchor, or are the same point.
 */
function isSameEnd(a: ConnectorEnd, b: ConnectorEnd): boolean {
  if (a.kind === 'point' || b.kind === 'point') {
    return a.kind === 'point' && b.kind === 'point' && a.x === b.x && a.y === b.y;
  }
  if (a.objectId !== b.objectId) return false;
  if (a.anchor === null || b.anchor === null) return a.anchor === b.anchor;
  return a.anchor.x === b.anchor.x && a.anchor.y === b.anchor.y;
}

/**
 * `setConnectorEnd`: attaches one end of a connector to an
 * object, at an anchor or with an automatic one (`null`, the side nearest the other end), or frees
 * it at a point given in board coordinates, stored in the connector's own frame, so an end
 * dropped inside a rotated group lands where the pointer put it. Only that end is written: each
 * end is its own key in the stored layout, so the drag merges with a concurrent move, restyle or
 * drag of the other end, and undoing it leaves the other end to whoever last changed it. Refused
 * for anything but a connector (`unsupported-type`), for a locked connector (`locked`), for
 * a target that is missing, a connector or a comment (the schema's reference rules), judged
 * for the end written only: the other end may sit on an object a peer's write left off the board
 * until the reference repair frees it, and the command still moves this one. Both
 * ends may be free (a free line, the floating dock's Connector with no ends); an end
 * already so writes nothing.
 */
export const setConnectorEndCommand: SetConnectorEndCommand = {
  name: 'setConnectorEnd',
  description:
    'Attaches one end of a connector to an object, or frees it at a board point; the other end stays. Refused for a locked connector.',
  input: setConnectorEndInputSchema,
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
    if (object.type !== 'connector') {
      const message = `"${object.id}" is a ${object.type}, not a connector`;
      problems.push(commandError('unsupported-type', object.id, ['id'], message));
    }
    if (object.locked) {
      problems.push(commandError('locked', object.id, ['id'], `"${object.id}" is locked`));
    }
    if (problems.length > 0 || object.type !== 'connector') return reject(problems);
    const { target } = input;
    let value: ConnectorEnd;
    if ('objectId' in target) {
      value = { kind: 'object', objectId: target.objectId, anchor: target.anchor };
    } else {
      const subBoard = new SubBoard(board);
      subBoard.addWithAncestors(object.id);
      const frames = subBoard.toBoard();
      const toBoard = unlessParentCycle(() => objectToBoardTransform(frames, object));
      if (toBoard === null) {
        const message = `the ancestors of "${object.id}" form a cycle`;
        return reject([commandError('parent-cycle', object.id, ['id'], message)]);
      }
      const placed = applyTransform(invertTransform(toBoard), target.point);
      // A connector stored far away can overflow the frame change; only what is not finite is
      // clamped.
      value = { kind: 'point', x: finiteCoordinate(placed.x), y: finiteCoordinate(placed.y) };
    }
    if (isSameEnd(value, object[input.end])) {
      return accept({ id: object.id, end: input.end, value: null });
    }
    const invalid: CommandError[] = [];
    const changed = checkObject(board, { ...object, [input.end]: value }, invalid);
    if (changed === undefined) return reject(invalid);
    // Only the end written is judged: the other may sit on an object a peer's write left off the
    // board, which the reference repair has yet to free, and a field the command does not write
    // never refuses it (item 1, nightly 40240436854).
    const refused = referenceErrors(board, [changed]).filter(({ path }) => path[0] === input.end);
    if (refused.length > 0) return reject(refused);
    return accept({ id: object.id, end: input.end, value });
  },
  apply(transaction, input, plan) {
    if (plan.value === null) return { changedIds: [] };
    transaction.patchObject(plan.id, { [plan.end]: plan.value });
    return { changedIds: [plan.id] };
  },
};
