import { z } from 'zod';

import { linkSchema } from '../fields/link.js';
import { layerShape } from '../fields/opacity.js';
import { visibilityShape } from '../fields/visibility.js';
import { assetIdSchema } from '../ids/asset-id.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/** How a link card arranges its preview: the image above the text, or beside it. */
export const LINK_LAYOUTS = ['vertical', 'horizontal'] as const;

/** A link card's layout: one of {@link LINK_LAYOUTS}. */
export type LinkLayout = (typeof LINK_LAYOUTS)[number];

/**
 * Where a link card's preview stands: `pending` while the page is fetched, then `ready`
 * with what it said, or `failed`, when the card shows only the URL and its domain.
 */
export const LINK_STATUSES = ['pending', 'ready', 'failed'] as const;

/** A link card's status: one of {@link LINK_STATUSES}. */
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** The most code points a link card stores of each of a page's texts. */
export interface LinkTextLimits {
  /** Of its title. */
  readonly title: number;
  /** Of its description. */
  readonly description: number;
  /** Of its site's name. */
  readonly siteName: number;
}

/** The most code points a link card stores of a page's title, description and site name. */
export const LINK_TEXT_LIMITS: LinkTextLimits = Object.freeze({
  title: 300,
  description: 1000,
  siteName: 120,
});

/** The longest `unfurlKey`, characters. */
const MAX_UNFURL_KEY_LENGTH = 64;

/** The text of a link card's preview, as a page gives it or as the card stores it. */
export interface LinkText {
  /** The page's title. */
  readonly title: string;
  /** The page's description. */
  readonly description: string;
  /** The site's name. */
  readonly siteName: string;
}

/**
 * A text trimmed and cut to at most `limit` code points, never splitting a surrogate pair.
 *
 * @param text - The text.
 * @param limit - The most code points kept.
 * @returns The clipped text.
 */
function clipCodePoints(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return Array.from(trimmed).slice(0, limit).join('');
}

/**
 * A page's preview text clipped as a link card stores it: each field trimmed and cut to
 * its {@link LINK_TEXT_LIMITS} in code points, so an emoji is never split. Pure; the input is not
 * changed.
 *
 * @param fields - The title, description and site name, as the page gave them.
 * @returns The clipped fields.
 */
export function clipLinkText(fields: LinkText): LinkText {
  return {
    title: clipCodePoints(fields.title, LINK_TEXT_LIMITS.title),
    description: clipCodePoints(fields.description, LINK_TEXT_LIMITS.description),
    siteName: clipCodePoints(fields.siteName, LINK_TEXT_LIMITS.siteName),
  };
}

/**
 * Validates a link card's text field: at most `limit` code points.
 *
 * @param limit - The most code points.
 * @param description - What the field holds.
 * @returns The schema.
 */
function linkTextSchema(limit: number, description: string) {
  return z
    .string()
    .refine((value) => Array.from(value).length <= limit, {
      message: `at most ${String(limit)} characters`,
    })
    .describe(description);
}

/** Validates a link card's URL: a stored link (`linkSchema`) on the web, http or https only. */
const linkCardUrlSchema = linkSchema
  .refine((value) => value.startsWith('https:') || value.startsWith('http:'), {
    message: 'A link card shows an http or https page.',
  })
  .describe('The page the card shows: an http or https URL.');

/** Validates the pixel size of a card's preview image or icon, as its asset measured it. */
const linkImageSizeSchema = z
  .strictObject({
    /** Width in pixels. */
    width: z.number().int().positive().describe('Width in pixels.'),
    /** Height in pixels. */
    height: z.number().int().positive().describe('Height in pixels.'),
  })
  .describe('The size in pixels of the image, as its asset measured it.');

/**
 * Validates a link card: a pasted URL shown as a preview of its page, the title,
 * description and site name the page gave (clipped, `clipLinkText`), its preview image and
 * favicon as assets, in a layout. The paster's client fetches the preview once, through the
 * assets service, and writes it while the card is still `pending` and its `unfurlKey` matches.
 */
export const linkObjectSchema = baseObjectSchema
  .extend({
    /** Always `'link'`: the discriminator of this object type. */
    type: z.literal('link'),
    ...boxShape,
    /** The page the card shows. */
    url: linkCardUrlSchema,
    /** The page's title, or empty. */
    title: linkTextSchema(LINK_TEXT_LIMITS.title, "The page's title, or empty."),
    /** The page's description, or empty. */
    description: linkTextSchema(LINK_TEXT_LIMITS.description, "The page's description, or empty."),
    /** The site's name, or empty. */
    siteName: linkTextSchema(LINK_TEXT_LIMITS.siteName, "The site's name, or empty."),
    /** The page's preview image, stored as an asset; absent when it has none. */
    imageAssetId: assetIdSchema
      .optional()
      .describe("The page's preview image, stored as an asset; absent when it has none."),
    /** The preview image's size in pixels, so the card can crop it to its area; absent with it. */
    imageSize: linkImageSizeSchema
      .optional()
      .describe("The preview image's size in pixels; absent when it has none."),
    /** The site's icon, stored as an asset; absent when it has none. */
    faviconAssetId: assetIdSchema
      .optional()
      .describe("The site's icon, stored as an asset; absent when it has none."),
    /** The icon's size in pixels; absent when it has none. */
    faviconSize: linkImageSizeSchema
      .optional()
      .describe("The icon's size in pixels; absent when it has none."),
    /** The image above the text (`vertical`) or beside it (`horizontal`). */
    layout: z
      .enum(LINK_LAYOUTS)
      .describe('The image above the text (vertical) or beside it (horizontal).'),
    /** Whether the preview is being fetched, has arrived, or could not be had. */
    status: z
      .enum(LINK_STATUSES)
      .describe('Whether the preview is being fetched, has arrived, or could not be had.'),
    /** Names the one fetch whose result the card takes, set by the paster's client. */
    unfurlKey: z
      .string()
      .min(1)
      .max(MAX_UNFURL_KEY_LENGTH)
      .describe("Names the one fetch whose result the card takes, set by the paster's client."),
    ...layerShape,
    ...visibilityShape,
  })
  .describe('A link preview card: a web page shown as its title, description and image.');

/** A link card. */
export type LinkObject = z.output<typeof linkObjectSchema>;
