import {
  BUILTIN_TOKEN_DEFAULTS,
  INK,
  INK_COLORS,
  isBuiltinToken,
  isTokenRef,
  type ColorMode,
  type InkTheme,
  type Rgba,
  type TokenRef,
  type TokenValues,
} from '@canvas/schema';

// The engine's resolution of colour tokens (tokens are resolved on the CPU, as
// ink is): a palette is one colour mode's values of one board's token table, with the host's ink
// colours, built once per mode for each table and theme and shared by every record of that mode.
// A record that names `'ink'` or a token carries its palette (`SceneObject.palette`), so a token
// edit, a theme switch or a mode change rewrites only those records, each from its palette.

/** What the `'ink'` colour token draws as in each theme (the schema's `INK_COLORS` shape). */
export type InkColors = Readonly<Record<InkTheme, Rgba>>;

/**
 * A board's colour token values as the engine reads them: each custom token or edited built-in
 * by id, with its light and dark values (a `TokenTable`'s entries satisfy it). Built-ins absent
 * from it draw their defaults.
 */
export type ColorTokenValues = ReadonlyMap<string, TokenValues>;

/** A colour as stored where it may be deferred: a tuple, `'ink'` or a token reference. */
export type DeferredColor = Rgba | typeof INK | TokenRef;

/** The table of a board that has edited nothing: the built-ins at their defaults. */
export const NO_COLOR_TOKENS: ColorTokenValues = new Map();

/**
 * Whether two colours have the same channels.
 *
 * @param a - One colour.
 * @param b - The other.
 * @returns True when equal channel by channel.
 */
export function isSameRgba(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * The token id a stored colour names: `'ink'` for the literal, a reference's id, else
 * `undefined` (a tuple, or a value no colour reader accepts).
 *
 * @param value - A stored colour.
 * @returns The id, or undefined.
 */
export function tokenIdOf(value: unknown): string | undefined {
  if (value === INK) return INK;
  return isTokenRef(value) ? value.token : undefined;
}

/**
 * One colour mode's resolution of a board's tokens: `'ink'` and `{ token:
 * 'ink' }` the board's ink (its edited entry, else the host's ink colour for the mode); another
 * token its table entry, else a built-in's default; a token the board lacks the ink. Immutable;
 * memoises each id it resolves.
 */
export class ColorPalette {
  /** The colour mode. */
  readonly mode: ColorMode;
  /** What ink draws as in this mode on this board. */
  readonly ink: Rgba;
  /** The table it resolves from. */
  readonly table: ColorTokenValues;
  private readonly resolved = new Map<string, Rgba>();

  /**
   * Builds a palette.
   *
   * @param mode - The colour mode.
   * @param table - The board's token values; default none (the built-ins' defaults).
   * @param inkColors - What ink draws as per theme when the board has not edited it.
   */
  constructor(
    mode: ColorMode,
    table: ColorTokenValues = NO_COLOR_TOKENS,
    inkColors: InkColors = INK_COLORS,
  ) {
    this.mode = mode;
    this.table = table;
    this.ink = table.get(INK)?.[mode] ?? inkColors[mode];
  }

  /**
   * What a token draws as in this palette.
   *
   * @param id - The token id.
   * @returns The colour.
   */
  tokenColor(id: string): Rgba {
    if (id === INK) return this.ink;
    let color = this.resolved.get(id);
    if (color === undefined) {
      const entry = this.table.get(id);
      color =
        entry?.[this.mode] ??
        (isBuiltinToken(id) ? BUILTIN_TOKEN_DEFAULTS[id][this.mode] : this.ink);
      this.resolved.set(id, color);
    }
    return color;
  }

  /**
   * Resolves a deferred colour: a tuple as is, `'ink'` or a token by {@link tokenColor}.
   *
   * @param color - The colour.
   * @returns The straight-alpha colour to write.
   */
  resolve(color: DeferredColor): Rgba {
    if (Array.isArray(color)) return color;
    return this.tokenColor(color === INK ? INK : color.token);
  }
}

/** The light theme's palette of a board with no edited token: what a pass uses outside a scene. */
export const LIGHT_PALETTE = new ColorPalette('light');

/**
 * The palette a scene object's colours resolve in: its own, or {@link LIGHT_PALETTE} when the
 * target carries none (a pass prepared outside a scene). Pure.
 *
 * @param target - The object as a pass sees it (`SceneObject`).
 * @param target.palette - Its palette, if any.
 * @returns The palette.
 */
export function paletteOf(target: { readonly palette?: ColorPalette }): ColorPalette {
  return target.palette ?? LIGHT_PALETTE;
}

/**
 * The palette a scene object's text resolves in: its text palette, else its own
 * (`paletteOf`). Pure.
 *
 * @param target - The object as a pass sees it (`SceneObject`).
 * @param target.palette - Its palette, if any.
 * @param target.textPalette - Its text's palette, if it differs.
 * @returns The palette.
 */
export function textPaletteOf(target: {
  readonly palette?: ColorPalette;
  readonly textPalette?: ColorPalette;
}): ColorPalette {
  return target.textPalette ?? paletteOf(target);
}

/**
 * Whether two tables resolve a token alike in both modes, against their own ink.
 *
 * @param id - The token id.
 * @param before - The earlier palettes, light and dark.
 * @param after - The later palettes.
 * @returns True when the token draws the same.
 */
export function isTokenUnchanged(
  id: string,
  before: Readonly<Record<ColorMode, ColorPalette>>,
  after: Readonly<Record<ColorMode, ColorPalette>>,
): boolean {
  return (
    isSameRgba(before.light.tokenColor(id), after.light.tokenColor(id)) &&
    isSameRgba(before.dark.tokenColor(id), after.dark.tokenColor(id))
  );
}
