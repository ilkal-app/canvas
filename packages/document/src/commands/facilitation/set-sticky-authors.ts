import { z } from 'zod';

import { accept, type Command } from '../command.js';

/** Validates the sticky author setting's input: whether authors are shown. */
export const setStickyAuthorsInputSchema = z
  .strictObject({
    /** Whether the board shows its stickies' authors. */
    isShown: z.boolean().describe("Whether the board shows its stickies' authors."),
  })
  .describe('Shows or hides the authors on the board’s stickies.');

/** What `setStickyAuthors` writes. */
export interface SetStickyAuthorsPlan {
  /** Whether authors are shown. */
  readonly isShown: boolean;
}

/** What `setStickyAuthors` did. */
export interface SetStickyAuthorsResult {
  /** Whether authors are shown now. */
  readonly isShown: boolean;
}

/**
 * `setStickyAuthors`: the board's "Show authors on stickies" setting, for every person
 * on the board. Written whole into the facilitation map (last writer wins); setting the value the
 * board already has writes nothing. The map is outside every undo history, so the command is
 * never undone, whatever its origin.
 */
export const setStickyAuthorsCommand: Command<
  typeof setStickyAuthorsInputSchema,
  SetStickyAuthorsPlan,
  SetStickyAuthorsResult
> = {
  name: 'setStickyAuthors',
  description: 'Shows or hides the authors on the board’s stickies.',
  input: setStickyAuthorsInputSchema,
  validate(context, input) {
    return accept({ isShown: input.isShown });
  },
  apply(transaction, input, plan) {
    transaction.setStickyAuthors(plan.isShown);
    return { isShown: plan.isShown };
  },
};
