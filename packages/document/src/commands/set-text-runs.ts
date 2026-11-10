import { objectIdSchema, textContentSchema, type ObjectId } from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { hasMeasuredBody, measuredSizeSchema } from './measured-size.js';
import type { PlannedPatch } from './object-patches.js';

/** Validates the input of {@link setTextRunsCommand}. */
export const setTextRunsInputSchema = textContentSchema
  .extend({
    /** The text, sticky, shape or connector whose text (or label) to replace. */
    id: objectIdSchema.describe(
      'The text, sticky, shape or connector whose text (or label) to replace.',
    ),
    /**
     * The box's new measured size, written in the same transaction as the text, so the stored
     * bounds (culling, hit testing) follow typing in one undo step; a text or sticky only.
     */
    size: measuredSizeSchema.optional(),
  })
  .describe("Replaces an object's text and style runs, or a shape's or connector's label.");

/** What {@link setTextRunsCommand} returns. */
export interface SetTextRunsResult {
  /** The object whose text changed. */
  readonly id: ObjectId;
}

/**
 * `setTextRuns`: replaces the text and style runs of a text or
 * sticky, or the label of a shape or connector (creating the label when there is none). The
 * store writes it as a minimal edit: the characters are changed by a common-prefix and suffix
 * diff and only the ranges whose style changed are reformatted, so a collaborator typing
 * elsewhere in the same text keeps their characters (it is never delete-all, insert-all). The
 * runs must obey the schema's run invariant and split the text between characters. A text or
 * sticky edit may carry the box's new measured `size`, applied in the same transaction, so a
 * collaborator's bounds follow the text and the edit stays one undo step; a label has no size of
 * its own, so a size for a shape or connector is refused (`unsupported-type`). A locked object's
 * text is refused (`locked`), as moving or resizing it is.
 */
export const setTextRunsCommand: Command<
  typeof setTextRunsInputSchema,
  PlannedPatch,
  SetTextRunsResult
> = {
  name: 'setTextRuns',
  description: "Replaces an object's text and style runs, or a shape's or connector's label.",
  input: setTextRunsInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      [input],
      (entry) => entry.id,
      () => ['id'],
    );
    const [target] = named;
    if (target === undefined) return reject(errors);
    const { object } = target;
    if (object.locked) {
      return reject([commandError('locked', object.id, ['id'], `"${object.id}" is locked`)]);
    }
    // The paragraphs are part of the full value: none given means every paragraph is
    // plain, so a body's stored ones are cleared rather than kept by the merge below.
    const content = { text: input.text, runs: input.runs, paragraphs: input.paragraphs };
    const isBody = hasMeasuredBody(object.type);
    const patch = isBody
      ? { ...content, ...input.size }
      : object.type === 'shape' || object.type === 'connector'
        ? { label: content }
        : null;
    if (patch === null) {
      const message = `a ${object.type} has no text`;
      return reject([commandError('unsupported-type', object.id, ['id'], message)]);
    }
    if (!isBody && input.size !== undefined) {
      const message = `a ${object.type}'s label has no size of its own`;
      return reject([commandError('unsupported-type', object.id, ['size'], message)]);
    }
    const checkErrors: CommandError[] = [];
    checkObject(context.board, { ...object, ...patch }, checkErrors);
    return checkErrors.length > 0 ? reject(checkErrors) : accept({ id: object.id, patch });
  },
  apply(transaction, input, plan) {
    transaction.patchObject(plan.id, plan.patch);
    return { id: plan.id };
  },
};
