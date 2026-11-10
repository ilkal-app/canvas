import { z } from 'zod';

import { objectIdSchema, type ObjectId } from '@canvas/schema';

import { planReorder, type ReorderDirection, type ReorderPlan } from '../z-order/reorder-plan.js';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import {
  accept,
  reject,
  type BoardReader,
  type Command,
  type CommandValidation,
} from './command.js';

/** The input of every reorder command: the objects to move, all children of one parent. */
export const reorderInputSchema = z
  .strictObject({
    /** The objects to move; at least one, each listed once. */
    ids: z
      .array(objectIdSchema)
      .min(1)
      .describe('The objects to move, each listed once; all must share one parent.'),
  })
  .describe('Objects to reorder among their siblings.');

/** What a reorder command returns. */
export interface ReorderResult {
  /** The objects whose `z` changed, sorted; empty when they were already in place. */
  readonly movedIds: readonly ObjectId[];
}

/** A reorder command. */
export type ReorderCommand = Command<typeof reorderInputSchema, ReorderPlan, ReorderResult>;

/**
 * Refuses the plan when an object it moves could not be written: the store validates the whole
 * object on every write, and a remote update is not validated (README, "Validation and trust"),
 * so a peer can leave an object the schema rejects. That is a refusal, not a throw from `apply`.
 *
 * @param board - The board before the command.
 * @param plan - The plan: the new key of each moved object.
 * @returns The rejection, or `undefined` when every moved object can be written.
 */
function rejectInvalidObjects(
  board: BoardReader,
  plan: ReorderPlan,
): CommandValidation<never> | undefined {
  const errors: CommandError[] = [];
  for (const [id, key] of plan.keys) {
    const object = board.get(id);
    if (object !== undefined) checkObject(board, { ...object, z: key }, errors);
  }
  return errors.length === 0 ? undefined : reject(errors);
}

/**
 * Builds the command for one order move. `validate` looks the objects up (each must exist and
 * be listed once) and plans the move with `planReorder`, which also checks that they share one
 * parent and that the new keys fit; the plan holds every new key, so `apply` only writes them.
 * Each object it moves is checked as the store will write it, so an object a peer left invalid
 * is refused (`invalid-object`) rather than thrown on in `apply`.
 *
 * @param name - The command name.
 * @param description - The sentence agents are shown.
 * @param direction - The move it makes.
 * @returns The command.
 */
function createReorderCommand(
  name: string,
  description: string,
  direction: ReorderDirection,
): ReorderCommand {
  return {
    name,
    description,
    input: reorderInputSchema,
    validate(context, input) {
      const { named, errors } = lookUpNamed(
        context.board,
        input.ids,
        (id) => id,
        (index) => ['ids', index],
      );
      if (errors.length > 0) return reject(errors);
      const plan = planReorder(
        context.board,
        named.map(({ object }) => object.id),
        direction,
      );
      if (!('issues' in plan)) return rejectInvalidObjects(context.board, plan) ?? accept(plan);
      return reject(
        plan.issues.flatMap((issue) =>
          issue.ids.map((id) =>
            commandError(issue.code, id, ['ids', input.ids.indexOf(id)], issue.message),
          ),
        ),
      );
    },
    apply(transaction, input, plan) {
      for (const [id, key] of plan.keys) transaction.patchObject(id, { z: key });
      return { movedIds: [...plan.keys.keys()].sort() };
    },
  };
}

/**
 * `bringToFront`: moves objects above every other sibling as one block, keeping their relative
 * order. Only the moved objects' `z` changes, so it merges with concurrent moves of others.
 */
export const bringToFrontCommand = createReorderCommand(
  'bringToFront',
  'Moves objects above all their siblings, keeping their order among themselves.',
  'front',
);

/** `sendToBack`: moves objects below every other sibling as one block, keeping their order. */
export const sendToBackCommand = createReorderCommand(
  'sendToBack',
  'Moves objects below all their siblings, keeping their order among themselves.',
  'back',
);

/**
 * `bringForward`: each run of selected siblings moves above the unselected sibling directly
 * above it; a run already at the front stays.
 */
export const bringForwardCommand = createReorderCommand(
  'bringForward',
  'Moves objects one step up among their siblings, above the next object above them.',
  'forward',
);

/**
 * `sendBackward`: each run of selected siblings moves below the unselected sibling directly
 * below it; a run already at the back stays.
 */
export const sendBackwardCommand = createReorderCommand(
  'sendBackward',
  'Moves objects one step down among their siblings, below the next object below them.',
  'backward',
);
