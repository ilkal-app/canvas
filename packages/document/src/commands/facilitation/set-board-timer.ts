import { z } from 'zod';

import {
  applyTimerAction,
  MAX_TIMER_DURATION_MS,
  MIN_TIMER_DURATION_MS,
  objectIdSchema,
  principalIdSchema,
  type BoardTimer,
  type PrincipalId,
} from '@canvas/schema';

import { commandError } from '../command-error.js';
import { accept, reject, type Command, type CommandContext } from '../command.js';

const durationMsSchema = z
  .number()
  .int()
  .min(MIN_TIMER_DURATION_MS)
  .max(MAX_TIMER_DURATION_MS)
  .describe('The duration, in ms: 1 s to 24 h.');

/** Validates a timer action: what a person does to the board timer. */
const timerActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    /** Starts the timer from its whole duration, replacing any timer. */
    kind: z.literal('start'),
    /** The duration, in ms. */
    durationMs: durationMsSchema,
    /** The section it is for, if any. */
    sectionId: objectIdSchema.nullable().optional().describe('The section it is for, if any.'),
  }),
  z.strictObject({
    /** Pauses a running timer. */
    kind: z.literal('pause'),
  }),
  z.strictObject({
    /** Resumes a paused timer. */
    kind: z.literal('resume'),
  }),
  z.strictObject({
    /** Resets the timer to idle at its duration. */
    kind: z.literal('reset'),
  }),
  z.strictObject({
    /** Sets a new duration, idle. */
    kind: z.literal('set-duration'),
    /** The new duration, in ms. */
    durationMs: durationMsSchema,
  }),
  z.strictObject({
    /** Removes the timer. */
    kind: z.literal('end'),
  }),
]);

/** Validates the input of {@link setBoardTimerCommand}. */
export const setBoardTimerInputSchema = z
  .strictObject({
    /** What to do. */
    action: timerActionSchema.describe('start, pause, resume, reset, set-duration or end.'),
    /** The moment of the action by the relay's clock: the collab client's server time. */
    serverNowMs: z
      .number()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .describe("The moment, ms since the epoch by the relay's clock."),
    /** Who acts, under the system origin; any other origin acts as its own principal. */
    actor: principalIdSchema.optional().describe('Who acts, for a system-origin run.'),
  })
  .describe('Starts, pauses, resumes, resets, re-sets or ends the board timer.');

/** What {@link setBoardTimerCommand} will write. */
export interface SetBoardTimerPlan {
  /** The timer after the action, or `undefined` for none. */
  readonly timer: BoardTimer | undefined;
  /** Whether that differs from the timer stored. */
  readonly isChanged: boolean;
}

/** What {@link setBoardTimerCommand} returns. */
export interface SetBoardTimerResult {
  /** The timer as written, or `undefined` for none. */
  readonly timer: BoardTimer | undefined;
  /** Whether the timer changed; false for an action that did not apply. */
  readonly isChanged: boolean;
}

/**
 * Who a timer action is recorded as: the actor named under the system origin (a person's
 * client runs timer actions as `system`, so they stay out of every undo history), else the
 * origin's principal.
 *
 * @param context - The command's context.
 * @param actor - The actor named in the input, if any.
 * @returns The principal.
 */
function actorOf(context: CommandContext, actor: PrincipalId | undefined): PrincipalId {
  return context.origin.kind === 'system'
    ? (actor ?? context.origin.principalId)
    : context.origin.principalId;
}

/**
 * `setBoardTimer`: applies a timer action at a moment by the relay's clock and writes
 * the board timer whole, so concurrent actions converge to one writer's timer. An action that
 * does not apply (pausing a timer that is not running) writes nothing. A `start` for a section
 * the board lacks is refused (`missing-object`). The facilitation map is outside every undo
 * history, so the command is never undone, whatever its origin; the app runs it as `system`.
 */
export const setBoardTimerCommand: Command<
  typeof setBoardTimerInputSchema,
  SetBoardTimerPlan,
  SetBoardTimerResult
> = {
  name: 'setBoardTimer',
  description: 'Starts, pauses, resumes, resets, re-sets or ends the board timer.',
  input: setBoardTimerInputSchema,
  validate(context, input) {
    const { action } = input;
    if (action.kind === 'start' && action.sectionId != null) {
      const { sectionId } = action;
      if (context.board.get(sectionId) === undefined) {
        const message = `there is no object "${sectionId}"`;
        return reject([
          commandError('missing-object', sectionId, ['action', 'sectionId'], message),
        ]);
      }
    }
    const stored = context.board.boardTimer?.current;
    const by = actorOf(context, input.actor);
    const timer = applyTimerAction(stored, action, input.serverNowMs, by);
    return accept({ timer, isChanged: timer !== stored });
  },
  apply(transaction, input, plan) {
    if (plan.isChanged) transaction.setBoardTimer(plan.timer);
    return { timer: plan.timer, isChanged: plan.isChanged };
  },
};
