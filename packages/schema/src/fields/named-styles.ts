import { z } from 'zod';

import { principalIdSchema } from '../ids/principal-id.js';

import { shadowLayersSchema } from './shadow.js';
import { styleIdSchema, type StyleId } from './style-id.js';
import { textStyleSchema } from './text-style.js';

// A board's named styles: text styles (a run's typography without its
// colour) and effect styles (shadow layers), each a board-level table like the colour tokens.
// An object or run names a style by id and stores the style's values beside the
// id, so drawing and measuring read the values as before; editing a style rewrites them.

/** The most text styles a board holds. */
export const MAX_TEXT_STYLES = 64;

/** The most effect styles a board holds. */
export const MAX_EFFECT_STYLES = 64;

/** The longest style name, in UTF-16 code units. */
export const MAX_STYLE_NAME_LENGTH = 40;

/**
 * Validates a style's name: 1 to 40 characters, without space at either end; slashes group
 * styles as in Figma (`UI/Title`). Unique per kind on a board, ignoring case.
 */
export const styleNameSchema = z
  .string()
  .min(1)
  .max(MAX_STYLE_NAME_LENGTH)
  .refine(
    (name) => name.trim() === name && name.length > 0,
    'a style name has no space at its ends',
  )
  .describe('The style name, 1 to 40 characters, unique per kind on the board; "/" groups styles.');

/**
 * Validates a text style's value: a run's typography (family, size, weight, slant and optional
 * letter-spacing, line-height, variable-font coordinates and face name) with the run's bounds, and no colour: a run keeps its own
 * colour, as in Figma.
 */
export const textStyleValueSchema = textStyleSchema
  .pick({
    fontFamily: true,
    fontSize: true,
    weight: true,
    italic: true,
    letterSpacing: true,
    lineHeight: true,
    fontVariations: true,
    fontFeatures: true,
    postScriptName: true,
  })
  .describe(
    "A text style: fontFamily, fontSize, weight, italic, and optional letterSpacing, lineHeight, fontVariations, fontFeatures and postScriptName, as a run's style takes them; no colour.",
  );

/** A text style's value: a run's typography without its colour. */
export type TextStyleValue = z.output<typeof textStyleValueSchema>;

/** The fields a text style governs on a run, in a fixed order. */
export const TEXT_STYLE_VALUE_FIELDS: readonly (keyof TextStyleValue)[] = Object.freeze([
  'fontFamily',
  'fontSize',
  'weight',
  'italic',
  'letterSpacing',
  'lineHeight',
  'fontVariations',
  'fontFeatures',
  'postScriptName',
]);

/** Validates an effect style's value: 1 to 8 drop shadows, drawn in order, the first lowest. */
export const effectStyleValueSchema = z
  .strictObject({
    /** The shadow layers, drawn in order, the first lowest. */
    shadows: shadowLayersSchema,
  })
  .describe('An effect style: shadows, 1 to 8 drop shadows drawn in order, the first lowest.');

/** An effect style's value: its shadow layers. */
export type EffectStyleValue = z.output<typeof effectStyleValueSchema>;

/**
 * Builds the schema of one entry of a style table.
 *
 * @param value - The schema of the style's value.
 * @returns The entry's schema.
 */
function styleEntrySchema<Value extends z.ZodType>(value: Value) {
  return z.strictObject({
    /** The style's id. */
    id: styleIdSchema,
    /** The style's name. */
    name: styleNameSchema,
    /** The style's value. */
    value,
    /** Who created the entry; `null` when unknown (an imported table). */
    createdBy: principalIdSchema.nullable().describe('Who created the entry, or null.'),
    /** When the entry was created, ms since the epoch; 0 when unknown. */
    createdAt: z.number().describe('When the entry was created, ms since the epoch; 0 if unknown.'),
  });
}

/** Validates one entry of a board's text style table. */
export const textStyleEntrySchema = styleEntrySchema(textStyleValueSchema);

/** Validates one entry of a board's effect style table. */
export const effectStyleEntrySchema = styleEntrySchema(effectStyleValueSchema);

/** One entry of a board's text style table. */
export type TextStyleEntry = z.output<typeof textStyleEntrySchema>;

/** One entry of a board's effect style table. */
export type EffectStyleEntry = z.output<typeof effectStyleEntrySchema>;

/** A board's text styles by id. */
export type TextStyleTable = ReadonlyMap<StyleId, TextStyleEntry>;

/** A board's effect styles by id. */
export type EffectStyleTable = ReadonlyMap<StyleId, EffectStyleEntry>;

/**
 * Compares style names as the board does: trimmed and case-blind.
 *
 * @param name - A name.
 * @returns Its comparison key.
 */
export function styleNameKey(name: string): string {
  return name.trim().toLowerCase();
}
