import { z } from 'zod';

import { autoLayoutSchema } from '../fields/auto-layout.js';
import { BOARD_BOUND } from '../fields/board-bound.js';
import { colorSchema, inkableColorSchema } from '../fields/color.js';
import { opacitySchema } from '../fields/opacity.js';
import { findRunIssues } from '../fields/text-content.js';
import { styleRunSchema, textStyleSchema } from '../fields/text-style.js';
import { assetIdSchema } from '../ids/asset-id.js';
import { ID_PATTERN, objectIdSchema } from '../ids/object-id.js';
import { imageObjectSchema } from '../objects/image-object.js';

import { MAX_INSTANCE_DEPTH } from './instance-limits.js';
import { variantSelectionSchema } from './variants.js';

/**
 * A style run of an override record: a run without a board text style:
 * a style's edits rewrite the runs of objects naming it, never an override's, so an override
 * holds plain values.
 */
const overrideRunSchema = styleRunSchema.extend({
  /** The style of every character in the run, naming no board text style. */
  style: textStyleSchema.omit({ textStyleId: true }),
});

/** Source instance ids through nested definitions, followed by the target child id. */
export const overridePathSchema = z.string().refine((path) => {
  const parts = path.split('/');
  return parts.length <= MAX_INSTANCE_DEPTH && parts.every((part) => ID_PATTERN.test(part));
}, 'an override path contains one to five source object ids');

/**
 * A partial text style an override lays over every run of a child's text: at least
 * one of the text style's fields, each within the text style's own bounds.
 */
export const textStyleOverrideSchema = z
  .strictObject({
    /** Font family name, 1 to 200 characters. */
    fontFamily: textStyleSchema.shape.fontFamily.optional(),
    /** Font size in world px, 4 to 400. */
    fontSize: textStyleSchema.shape.fontSize.optional(),
    /** The glyph colour: a tuple, `'ink'` for the viewer's theme ink, or a token reference. */
    color: inkableColorSchema
      .optional()
      .describe('Glyph colour: RGBA tuple, "ink" or a board colour token { token }.'),
    /** 400 (regular) or 700 (bold). */
    weight: textStyleSchema.shape.weight.optional(),
    /** Whether the text is set in the italic face. */
    italic: textStyleSchema.shape.italic.optional(),
    /** Variable-font coordinates by axis tag; empty sets the font's defaults. */
    fontVariations: textStyleSchema.shape.fontVariations,
    /** OpenType features by tag; empty sets the defaults. */
    fontFeatures: textStyleSchema.shape.fontFeatures,
    /** The text's language: a BCP 47 tag. */
    lang: textStyleSchema.shape.lang,
    /** The face's PostScript name. */
    postScriptName: textStyleSchema.shape.postScriptName,
  })
  .refine((style) => Object.values(style).some((value) => value !== undefined), {
    message: 'a text style override must set at least one field',
  });

/** A partial text style laid over every run of an overridden child's text. */
export type TextStyleOverride = z.output<typeof textStyleOverrideSchema>;

/**
 * A record's layout patch for an auto-layout container: its stacking direction, gap,
 * padding (four sides together), alignment and justification, each merged over the container's
 * own. Sizing (hug or fixed) is not overridable, nor is auto-layout added or removed.
 */
export const autoLayoutOverrideSchema = autoLayoutSchema
  .pick({ direction: true, gap: true, padding: true, align: true, justify: true })
  .partial();

/** A record's layout patch for an auto-layout container. */
export type AutoLayoutOverride = z.output<typeof autoLayoutOverrideSchema>;

/**
 * Content, colours, text styles, image data, opacity and visibility may differ from the main, and (in a
 * variant's preset) a child's box and an auto-layout container's layout. Stroke widths
 * keep inheriting; an instance's own size lives outside its own records.
 * These are a record's fields one by one; {@link overrideRecordSchema} adds the rule pairing
 * `runs` with `text`, which a command checks itself so it can refuse with `invalid-override`.
 */
export const overrideFieldsSchema = z
  .strictObject({
    /** Replacement characters, inheriting the main's current text or label styles unless `runs` is set. */
    text: z
      .string()
      .optional()
      .describe('Replacement text inheriting source styles unless runs is set.'),
    /** Style runs covering `text` exactly, as stored text uses them; only beside `text`. */
    runs: z
      .array(overrideRunSchema)
      .optional()
      .describe('Style runs covering text, as stored text uses them; requires text.'),
    /** A partial style laid over every run of the resolved text, including later main edits. */
    textStyle: textStyleOverrideSchema
      .optional()
      .describe('Partial text style laid over every run of the resolved text.'),
    /** Replacement fill colour. */
    fill: colorSchema.optional().describe('Replacement fill colour: a tuple or a token.'),
    /** Replacement colour of an existing stroke; its width remains inherited. */
    strokeColor: colorSchema
      .optional()
      .describe('Replacement stroke colour, a tuple or a token; width stays inherited.'),
    /** Replacement sticky background colour. */
    color: colorSchema
      .optional()
      .describe('Replacement sticky background colour: a tuple or a token.'),
    /** Replacement image asset. */
    assetId: assetIdSchema.optional().describe('Replacement image asset id.'),
    /** Replacement image dimensions in source pixels. */
    naturalSize: imageObjectSchema.shape.naturalSize
      .optional()
      .describe('Replacement image dimensions in pixels.'),
    /** Replacement crop, preserving the image's fitted aspect ratio. */
    crop: imageObjectSchema.shape.crop.optional().describe('Replacement image crop.'),
    /** Replacement layer opacity from 0 to 1; an image's replaces its own. */
    opacity: opacitySchema.optional().describe('Replacement layer opacity from 0 to 1.'),
    /** Whether this child and its descendants are hidden in the instance. */
    isHidden: z.boolean().optional().describe('Whether to hide the source child and descendants.'),
    /** The child's x in its parent's frame as the main has it; world units. */
    x: z
      .number()
      .min(-BOARD_BOUND)
      .max(BOARD_BOUND)
      .optional()
      .describe("The child's x in its parent's frame, as the main has it; ignored in a stack."),
    /** The child's y in its parent's frame as the main has it; world units. */
    y: z
      .number()
      .min(-BOARD_BOUND)
      .max(BOARD_BOUND)
      .optional()
      .describe("The child's y in its parent's frame, as the main has it; ignored in a stack."),
    /** The child's width as the main has it; at the main's own id, the variant's. */
    width: z
      .number()
      .min(0)
      .max(BOARD_BOUND)
      .optional()
      .describe("The child's width as the main has it; at the main's own id, the variant's."),
    /** The child's height as the main has it; at the main's own id, the variant's. */
    height: z
      .number()
      .min(0)
      .max(BOARD_BOUND)
      .optional()
      .describe("The child's height as the main has it; at the main's own id, the variant's."),
    /** An auto-layout container's layout patch, merged over its own. */
    autoLayout: autoLayoutOverrideSchema
      .optional()
      .describe("An auto-layout container's direction, gap, padding, align or justify."),
    /**
     * The size of the overridden text as its writer measured it, so an auto-layout main
     * reflows the same everywhere; `fonts` is the bundled-font fingerprint it was measured with,
     * absent when unknown, and a size measured with other fonts is measured again.
     */
    measuredSize: z
      .strictObject({
        /** Measured width, world units. */
        width: z.number().min(0).max(BOARD_BOUND),
        /** Measured height, world units. */
        height: z.number().min(0).max(BOARD_BOUND),
        /** The bundled-font fingerprint it was measured with. */
        fonts: z.string().min(1).max(64).optional(),
      })
      .optional()
      .describe('The overridden text size its writer measured, with the font fingerprint used.'),
    /** A nested instance's variant selection, merged over its own axis by axis. */
    variant: variantSelectionSchema
      .optional()
      .describe("A nested instance's variant selection, over its own axis by axis."),
    /**
     * A nested instance's swapped-in main. It renders while it names a live main that
     * makes no cycle and stays within depth; otherwise the slot's stored main renders and this
     * record is kept, so restoring the target restores the swap.
     */
    mainId: objectIdSchema
      .optional()
      .describe("A nested instance's swapped-in main; the slot's own main renders if it is lost."),
  })
  .refine((record) => Object.values(record).some((value) => value !== undefined), {
    message: 'an override record must replace at least one property',
  });

/**
 * Why an override's `runs` cannot be stored beside its `text`: runs without text, or runs that do
 * not cover the text as stored text runs must. Empty when the record has no runs or they fit.
 *
 * @param record - An override record's fields.
 * @param record.text - Its replacement text, if any.
 * @param record.runs - Its style runs, if any.
 * @returns The issues, as messages.
 */
export function overrideRunsIssues(record: {
  readonly text?: string | undefined;
  readonly runs?: readonly z.output<typeof styleRunSchema>[] | undefined;
}): string[] {
  if (record.runs === undefined) return [];
  if (record.text === undefined) return ['runs are allowed only beside text'];
  return findRunIssues(record.text, record.runs);
}

/**
 * A stored override record: its fields, with `runs` allowed only beside `text` and following the
 * stored-text run rules (`findRunIssues`), so a record never pairs characters with runs that do
 * not cover them.
 */
export const overrideRecordSchema = overrideFieldsSchema.superRefine((record, context) => {
  for (const message of overrideRunsIssues(record)) {
    context.addIssue({ code: 'custom', path: ['runs'], message, input: record.runs });
  }
});

/** One stored override record: replacement content, colours, text style, image or visibility. */
export type OverrideRecord = z.output<typeof overrideRecordSchema>;

/** Validates independent override records keyed by descendant source path. */
export const instanceOverridesSchema = z.record(overridePathSchema, overrideRecordSchema);

/** Override records as a command takes them: each record's fields, its runs checked later. */
export const instanceOverrideFieldsSchema = z.record(overridePathSchema, overrideFieldsSchema);

/** Independent per-child records; concurrent writes to one path are whole-record LWW. */
export type InstanceOverrides = z.output<typeof instanceOverridesSchema>;
