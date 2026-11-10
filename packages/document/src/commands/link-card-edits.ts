import { z } from 'zod';

import { objectIdSchema, textStyleSchema, type ObjectId } from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import type { CreateObjectsPlan } from './create-objects-plan.js';
import { planCreateObjects } from './create-objects-plan.js';
import { createObjectsCommand } from './create-objects.js';
import { deleteObjectsCommand, type DeleteObjectsPlan } from './delete-objects.js';
import { linkCardSizeOf, type LinkCardSize } from './link-card-sizes.js';

// A link card's popover edits: fetch a failed card's page again, and turn a card into
// a text link.

/** The line height of the text a card turns into, in multiples of its font size. */
const LINE_HEIGHT = 1.25;

/** The estimated advance of one character, in multiples of the font size: the editor re-measures. */
const CHARACTER_WIDTH = 0.6;

/** Validates the input of {@link retryLinkUnfurlCommand}. */
export const retryLinkUnfurlInputSchema = z
  .strictObject({
    /** The card. */
    id: objectIdSchema.describe('The failed link card.'),
    /** The new fetch's key, which its result must carry. */
    unfurlKey: z.string().min(1).max(64).describe("The new fetch's key."),
  })
  .describe("Fetches a failed link card's page again: the card goes back to pending.");

/** What {@link retryLinkUnfurlCommand} and {@link linkCardToTextCommand} return. */
export interface LinkCardEditResult {
  /** The card retried, or the text that replaced the card. */
  readonly id: ObjectId;
}

/** The command type of {@link retryLinkUnfurlCommand}: its plan is the card's full size. */
export type RetryLinkUnfurlCommand = Command<
  typeof retryLinkUnfurlInputSchema,
  LinkCardSize,
  LinkCardEditResult
>;

/**
 * `retryLinkUnfurl` (the failed card's Retry): a failed card goes back to `pending`
 * under a new fetch key, at its layout's full size, so the client that retries fetches its page
 * again and writes the result (`applyLinkUnfurl`). Refused for a missing object, one that is not
 * a link card, or a card that has not failed.
 */
export const retryLinkUnfurlCommand: RetryLinkUnfurlCommand = {
  name: 'retryLinkUnfurl',
  description: "Fetches a failed link card's page again.",
  input: retryLinkUnfurlInputSchema,
  validate(context, input) {
    const object = context.board.get(input.id);
    if (object?.type !== 'link') {
      const message = `there is no link card "${input.id}"`;
      return reject([commandError('missing-object', input.id, ['id'], message)]);
    }
    if (object.status !== 'failed') {
      const message = `link card "${input.id}" has not failed`;
      return reject([commandError('invalid-input', input.id, ['id'], message)]);
    }
    return accept({ ...linkCardSizeOf(object.layout, 'pending') });
  },
  apply(transaction, input, plan) {
    transaction.patchObject(input.id, {
      status: 'pending',
      unfurlKey: input.unfurlKey,
      width: plan.width,
      height: plan.height,
    });
    return { id: input.id };
  },
};

/** Validates the input of {@link linkCardToTextCommand}. */
export const linkCardToTextInputSchema = z
  .strictObject({
    /** The card. */
    id: objectIdSchema.describe('The link card.'),
    /** The text's style; its link is the card's URL. */
    style: textStyleSchema.describe("The text's style."),
  })
  .describe('Turns a link card into a text that links to its page.');

/** What {@link linkCardToTextCommand} writes: the text created and the card deleted. */
export interface LinkCardToTextPlan {
  /** The text. */
  readonly created: CreateObjectsPlan;
  /** The card. */
  readonly deleted: DeleteObjectsPlan;
}

/** The command type of {@link linkCardToTextCommand}. */
export type LinkCardToTextCommand = Command<
  typeof linkCardToTextInputSchema,
  LinkCardToTextPlan,
  LinkCardEditResult
>;

/**
 * `linkCardToText` (the card's To text link): replaces a link card with a text in its
 * place, centred where the card was, in the same parent: the page's title (or its URL) in the
 * given style, linked to the URL. One transaction, so one undo step; the box is estimated from
 * the characters and re-measured by the editor, as a pasted text's is. Refused for a missing
 * object, one that is not a link card, or a locked card.
 */
export const linkCardToTextCommand: LinkCardToTextCommand = {
  name: 'linkCardToText',
  description: 'Turns a link card into a text that links to its page.',
  input: linkCardToTextInputSchema,
  validate(context, input) {
    const card = context.board.get(input.id);
    const errors: CommandError[] = [];
    if (card?.type !== 'link') {
      const message = `there is no link card "${input.id}"`;
      return reject([commandError('missing-object', input.id, ['id'], message)]);
    }
    const text = card.title === '' ? card.url : card.title;
    const { fontSize } = input.style;
    const width = Math.max(1, Array.from(text).length * fontSize * CHARACTER_WIDTH);
    const height = fontSize * LINE_HEIGHT;
    const created = planCreateObjects(context, {
      objects: [
        {
          type: 'text',
          parentId: null,
          x: card.x + card.width / 2 - width / 2,
          y: card.y + card.height / 2 - height / 2,
          rotation: card.rotation,
          locked: false,
          width,
          height,
          text,
          runs: [{ length: text.length, style: { ...input.style, link: card.url } }],
          align: 'left',
          autoWidth: true,
          verticalAlign: 'top',
        },
      ],
      parentId: card.parentId,
      ...(card.pageId === undefined || card.pageId === null ? {} : { pageId: card.pageId }),
    });
    if (!created.isValid) errors.push(...created.errors);
    const deleted = deleteObjectsCommand.validate(context, {
      ids: [input.id],
      connectorPolicy: 'detach',
    });
    if (!deleted.isValid) errors.push(...deleted.errors);
    if (!created.isValid || !deleted.isValid || errors.length > 0) return reject(errors);
    return accept({ created: created.plan, deleted: deleted.plan });
  },
  apply(transaction, input, plan) {
    const { ids } = createObjectsCommand.apply(
      transaction,
      { objects: [], parentId: null },
      plan.created,
    );
    deleteObjectsCommand.apply(transaction, { ids: [], connectorPolicy: 'detach' }, plan.deleted);
    const [id] = ids;
    return { id: id ?? input.id };
  },
};
