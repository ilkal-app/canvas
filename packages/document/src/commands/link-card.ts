import { z } from 'zod';

import {
  assetIdSchema,
  clipLinkText,
  LINK_LAYOUTS,
  linkObjectSchema,
  objectIdSchema,
  type LinkLayout,
  type ObjectId,
} from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { FAILED_LINK_CARD_HEIGHT, linkCardSizeOf, type LinkCardSize } from './link-card-sizes.js';

/** Validates a page's preview as the assets service gives it, before clipping. */
export const linkUnfurlOutcomeSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      /** The page was fetched. */
      status: z.literal('ready'),
      /** The page's title, clipped as the card stores it. */
      title: z.string().max(100_000).describe("The page's title."),
      /** The page's description, clipped as the card stores it. */
      description: z.string().max(100_000).describe("The page's description."),
      /** The site's name, clipped as the card stores it. */
      siteName: z.string().max(100_000).describe("The site's name."),
      /** The page's preview image, stored as an asset. */
      imageAssetId: assetIdSchema.optional().describe("The page's preview image asset."),
      /** The preview image's size in pixels; kept only with its asset. */
      imageSize: linkObjectSchema.shape.imageSize,
      /** The site's icon, stored as an asset. */
      faviconAssetId: assetIdSchema.optional().describe("The site's icon asset."),
      /** The icon's size in pixels; kept only with its asset. */
      faviconSize: linkObjectSchema.shape.faviconSize,
    }),
    z.strictObject({
      /** The page could not be had: the card shows only the URL and its domain. */
      status: z.literal('failed'),
    }),
  ])
  .describe('What fetching the page gave: its preview, or failure.');

/** What fetching a link card's page gave: its preview, or failure. */
export type LinkUnfurlOutcome = z.input<typeof linkUnfurlOutcomeSchema>;

/** Validates the input of {@link applyLinkUnfurlCommand}. */
export const applyLinkUnfurlInputSchema = z
  .strictObject({
    /** The card. */
    id: objectIdSchema.describe('The link card.'),
    /** The fetch this result is for: the card's `unfurlKey`. */
    unfurlKey: z.string().min(1).max(64).describe("The fetch this result is for: the card's key."),
    /** What the fetch gave. */
    outcome: linkUnfurlOutcomeSchema,
  })
  .describe("Writes a fetched page's preview into a pending link card.");

/** What {@link applyLinkUnfurlCommand} writes, if anything. */
export interface ApplyLinkUnfurlPlan {
  /** The fields written; undefined when the result is stale and nothing is written. */
  readonly patch: Readonly<Record<string, unknown>> | undefined;
}

/** The outcome of {@link applyLinkUnfurlCommand}. */
export interface ApplyLinkUnfurlResult {
  /** Whether the card took the result: false when it was no longer pending or its key differs. */
  readonly isApplied: boolean;
}

/** The command type of {@link applyLinkUnfurlCommand}. */
export type ApplyLinkUnfurlCommand = Command<
  typeof applyLinkUnfurlInputSchema,
  ApplyLinkUnfurlPlan,
  ApplyLinkUnfurlResult
>;

/**
 * The fields a fetch's outcome writes into a card: its status and, when ready, its clipped text
 * and assets.
 *
 * @param outcome - What the fetch gave.
 * @returns The fields.
 */
function unfurlPatchOf(
  outcome: z.output<typeof linkUnfurlOutcomeSchema>,
): Readonly<Record<string, unknown>> {
  // A failed card is compact (frame L3): its URL and "No preview available" alone.
  if (outcome.status === 'failed') return { status: 'failed', height: FAILED_LINK_CARD_HEIGHT };
  const { imageAssetId, imageSize, faviconAssetId, faviconSize } = outcome;
  return {
    status: 'ready',
    ...clipLinkText(outcome),
    ...(imageAssetId === undefined ? {} : { imageAssetId }),
    ...(imageAssetId === undefined || imageSize === undefined ? {} : { imageSize }),
    ...(faviconAssetId === undefined ? {} : { faviconAssetId }),
    ...(faviconAssetId === undefined || faviconSize === undefined ? {} : { faviconSize }),
  };
}

/**
 * `applyLinkUnfurl`: writes a fetched page's preview into a link card, once. It applies
 * only while the card is still `pending` and its `unfurlKey` is the one given; otherwise it
 * writes nothing and says so, so a stale or repeated result never overwrites a newer one. The
 * fields each have a key of their own (`codec/object-layout.ts`), so a layout switch meanwhile
 * merges with it. A failure makes the card compact (`FAILED_LINK_CARD_HEIGHT`). Refused for a
 * missing object or one that is not a link card.
 */
export const applyLinkUnfurlCommand: ApplyLinkUnfurlCommand = {
  name: 'applyLinkUnfurl',
  description: "Writes a fetched page's preview into a pending link card, once.",
  input: applyLinkUnfurlInputSchema,
  validate(context, input) {
    const object = context.board.get(input.id);
    const errors: CommandError[] = [];
    if (object?.type !== 'link') {
      const message = `there is no link card "${input.id}"`;
      errors.push(commandError('missing-object', input.id, ['id'], message));
      return reject(errors);
    }
    if (object.status !== 'pending' || object.unfurlKey !== input.unfurlKey) {
      return accept({ patch: undefined });
    }
    const patch = unfurlPatchOf(input.outcome);
    checkObject(context.board, { ...object, ...patch }, errors);
    return errors.length > 0 ? reject(errors) : accept({ patch });
  },
  apply(transaction, input, plan) {
    if (plan.patch !== undefined) transaction.patchObject(input.id, plan.patch);
    return { isApplied: plan.patch !== undefined };
  },
};

/** Validates the input of {@link setLinkLayoutCommand}. */
export const setLinkLayoutInputSchema = z
  .strictObject({
    /** The cards. */
    ids: z.array(objectIdSchema).min(1).describe('The link cards.'),
    /** The layout to give them. */
    layout: z.enum(LINK_LAYOUTS).describe('The image above the text, or beside it.'),
  })
  .describe("Sets link cards' layout.");

/** What {@link setLinkLayoutCommand} writes. */
export interface SetLinkLayoutPlan {
  /** The cards whose layout changes, and the size each takes. */
  readonly changed: readonly ObjectId[];
  /** Each changed card's new size, in the order of `changed`. */
  readonly sizes?: readonly LinkCardSize[];
}

/** The command type of {@link setLinkLayoutCommand}. */
export type SetLinkLayoutCommand = Command<
  typeof setLinkLayoutInputSchema,
  SetLinkLayoutPlan,
  SetLinkLayoutPlan
>;

/**
 * `setLinkLayout`: sets link cards' layout, the image above the text (`vertical`) or
 * beside it (`horizontal`), from the card's popover, and the layout's size (`linkCardSizeOf`),
 * from the card's top-left corner. It writes the `style` group, so it merges with a preview
 * arriving meanwhile. Refused when an id names no link card.
 */
export const setLinkLayoutCommand: SetLinkLayoutCommand = {
  name: 'setLinkLayout',
  description: "Sets link cards' layout: the image above the text, or beside it.",
  input: setLinkLayoutInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const changed: ObjectId[] = [];
    const sizes: LinkCardSize[] = [];
    input.ids.forEach((id, index) => {
      const object = context.board.get(id);
      if (object?.type !== 'link') {
        errors.push(
          commandError('missing-object', id, ['ids', index], `there is no link card "${id}"`),
        );
      } else if (object.layout !== input.layout) {
        changed.push(id);
        sizes.push({ ...linkCardSizeOf(input.layout, object.status) });
      }
    });
    return errors.length > 0 ? reject(errors) : accept({ changed, sizes });
  },
  apply(transaction, input, plan) {
    const layout: LinkLayout = input.layout;
    plan.changed.forEach((id, index) => {
      transaction.patchObject(id, { layout, ...plan.sizes?.[index] });
    });
    return { changed: plan.changed };
  },
};
