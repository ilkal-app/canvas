import { z } from 'zod';

import { principalIdSchema } from '../ids/principal-id.js';

import {
  INK,
  INK_COLORS,
  rgbaSchema,
  type InkableColor,
  type InkTheme,
  type Rgba,
} from './color.js';
import { isTokenRef, tokenIdSchema, type TokenId } from './token-ref.js';

// Board colour tokens: six built-ins every board has, whose values a
// board may edit but never delete, and up to 64 custom tokens per board. Each has a light and a
// dark value; an object draws a token in its effective colour mode (`effectiveColorMode`). A
// board without entries resolves the built-ins to these defaults; `@canvas/document` stores an
// entry only for a custom token or an edited built-in.

/** A colour mode: which of a token's two values an object draws. The viewer's theme by default. */
export type ColorMode = InkTheme;

/** The colour modes, in their stored spelling. */
export const COLOR_MODES = ['light', 'dark'] as const satisfies readonly ColorMode[];

/**
 * Validates an object's own colour mode (a frame's, a main's or an instance's): which
 * value of every token its content draws. Absent: inherited (`effectiveColorMode`).
 */
export const colorModeSchema = z
  .enum(COLOR_MODES)
  .describe(
    "The colour mode of this container's content: 'light' or 'dark'. Omit to inherit from the enclosing frame, main or instance, else the viewer's theme.",
  );

/** The built-in tokens, by id; each id is also the token's fixed name. */
export const BUILTIN_TOKENS = ['ink', 'text', 'muted', 'surface', 'border', 'accent'] as const;

/** One of {@link BUILTIN_TOKENS}. */
export type BuiltinTokenId = (typeof BUILTIN_TOKENS)[number];

/** The most custom tokens a board may be given by `setColorToken` (a creation limit). */
export const MAX_CUSTOM_TOKENS = 64;

/** The longest token name, in UTF-16 code units. */
export const MAX_TOKEN_NAME_LENGTH = 40;

/** A token's two values. */
export interface TokenValues {
  /** What the token draws as in the light mode. */
  readonly light: Rgba;
  /** What the token draws as in the dark mode. */
  readonly dark: Rgba;
}

/**
 * Converts a `#rrggbb` hex colour to an opaque tuple, at module load.
 *
 * @param hex - `#` and six hex digits.
 * @returns The tuple, frozen.
 */
function hexColor(hex: string): Rgba {
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return Object.freeze([channel(1), channel(3), channel(5), 1]) as unknown as Rgba;
}

/**
 * Freezes a token's values.
 *
 * @param light - The light value, `#rrggbb`.
 * @param dark - The dark value, `#rrggbb`.
 * @returns The values, frozen.
 */
function values(light: string, dark: string): TokenValues {
  return Object.freeze({ light: hexColor(light), dark: hexColor(dark) });
}

/**
 * The built-in tokens' default values: `ink` is {@link INK_COLORS}; the others are the app's
 * Vellum (light) and Graphite (dark) theme tokens: `text` = `ink/primary`, `muted` =
 * `ink/secondary`, `surface` = `surface/sheet`, `border` = `line/strong`, `accent` = `hand/you`.
 */
export const BUILTIN_TOKEN_DEFAULTS: Readonly<Record<BuiltinTokenId, TokenValues>> = Object.freeze({
  ink: INK_COLORS,
  text: values('#1e1f1c', '#ecebe5'),
  muted: values('#5d5c57', '#a4a39c'),
  surface: values('#f3f2ee', '#2b2c29'),
  border: values('#bfbdb5', '#51534c'),
  accent: values('#b7801c', '#e3a93b'),
});

/**
 * Tells whether a token id is a built-in's.
 *
 * @param id - A token id, or anything.
 * @returns True for one of {@link BUILTIN_TOKENS}.
 */
export function isBuiltinToken(id: unknown): id is BuiltinTokenId {
  return typeof id === 'string' && (BUILTIN_TOKENS as readonly string[]).includes(id);
}

/** Validates a token name: 1 to 40 code units, not only spaces. */
export const tokenNameSchema = z
  .string()
  .min(1)
  .max(MAX_TOKEN_NAME_LENGTH)
  .refine((name) => name.trim().length > 0, 'a token name is not blank')
  .describe('The token name, 1 to 40 characters, unique on the board.');

/**
 * Validates one entry of a board's token table: a custom token, or an edited built-in (`builtin`,
 * its id and name the built-in's), with its light and dark values and who created it.
 */
export const tokenEntrySchema = z.strictObject({
  /** The token id: a built-in's name or a custom id. */
  id: tokenIdSchema,
  /** The name shown in the colour picker; a built-in's is its id. */
  name: tokenNameSchema,
  /** The light mode's value. */
  light: rgbaSchema,
  /** The dark mode's value. */
  dark: rgbaSchema,
  /** Whether this is an edited built-in. */
  builtin: z.boolean().describe('Whether this is an edited built-in token.'),
  /** Who created the entry; `null` when unknown (an imported table). */
  createdBy: principalIdSchema.nullable().describe('Who created the entry, or null.'),
  /** When the entry was created, ms since the epoch; 0 when unknown. */
  createdAt: z.number().describe('When the entry was created, ms since the epoch; 0 if unknown.'),
});

/** One entry of a board's token table. */
export type TokenEntry = z.output<typeof tokenEntrySchema>;

/** A board's token table: its custom tokens and edited built-ins, by id. */
export type TokenTable = ReadonlyMap<TokenId, TokenEntry>;

/**
 * The values a token draws as on a board: its table entry's, else a built-in's defaults.
 *
 * @param id - The token id.
 * @param table - The board's token table; absent for the built-in defaults alone.
 * @returns The values, or `undefined` for a token the board does not have.
 */
export function tokenValuesOf(id: string, table?: TokenTable): TokenValues | undefined {
  const entry = table?.get(id);
  if (entry !== undefined) return entry;
  return isBuiltinToken(id) ? BUILTIN_TOKEN_DEFAULTS[id] : undefined;
}

/**
 * Resolves a stored colour in one colour mode: a tuple as is; `'ink'` or a token
 * reference the board's value for that token in that mode (an edited built-in or a custom token
 * from the table, else the built-in default); an unknown token the `ink` token's value in that
 * mode (`validateBoard` reports it as `unknown-color-token`). `'ink'` and `{ token: 'ink' }`
 * resolve alike. Pure; never throws.
 *
 * @param value - The stored colour.
 * @param mode - The object's effective colour mode.
 * @param table - The board's token table; absent for the built-in defaults alone.
 * @returns The straight-alpha colour to draw.
 */
export function resolveColor(value: InkableColor, mode: ColorMode, table?: TokenTable): Rgba {
  if (Array.isArray(value)) return value;
  const id = value === INK ? INK : isTokenRef(value) ? value.token : INK;
  const found = tokenValuesOf(id, table) ?? tokenValuesOf(INK, table) ?? INK_COLORS;
  return found[mode];
}

/**
 * Resolves a colour for one viewer with the built-in values only: {@link INK} and `{ token:
 * 'ink' }` become the theme's ink colour, a tuple stays, and another token reference becomes the
 * built-in default of that token in the theme, or ink for a token that is not a built-in. A
 * board's own values need {@link resolveColor} and its token table.
 *
 * @param color - A colour tuple, the ink token or a token reference.
 * @param theme - The viewer's theme.
 * @param inkColors - What ink draws as per theme; {@link INK_COLORS} by default.
 * @returns The tuple to draw.
 */
export function resolveInk(
  color: InkableColor,
  theme: InkTheme,
  inkColors: Readonly<Record<InkTheme, Rgba>> = INK_COLORS,
): Rgba {
  if (Array.isArray(color)) return color;
  const id = isTokenRef(color) ? color.token : INK;
  if (id === INK || !isBuiltinToken(id)) return inkColors[theme];
  return BUILTIN_TOKEN_DEFAULTS[id][theme];
}
