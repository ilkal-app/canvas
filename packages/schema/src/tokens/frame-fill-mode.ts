import {
  BUILTIN_TOKEN_DEFAULTS,
  isBuiltinToken,
  type ColorMode,
  type TokenValues,
} from '../fields/color-tokens.js';
import { INK, INK_COLORS, type Rgba } from '../fields/color.js';
import { isGradient, paintAverageColor, type Paint } from '../fields/paint.js';
import { isTokenRef } from '../fields/token-ref.js';
import type { BoardObject } from '../objects/board-object.js';

import {
  colorModeAncestors,
  effectiveColorMode,
  type ColorModeBoard,
  type ColorModeFallback,
} from './effective-color-mode.js';

// The frame-fill rule (the tokens' `fallbackMode`): with no explicit `colorMode`
// on any ancestor, the nearest ancestor frame with a fill decides the mode of what sits on it,
// dark when that fill is dark by luminance, so `'ink'` and every token read against the frame
// they are drawn on rather than the viewer's canvas. Fills are judged top-down, since a fill may
// be a token whose value is the one of its own frame's mode. Pure.

/**
 * The WCAG relative luminance of an sRGB colour (its alpha ignored).
 *
 * @param color - The colour.
 * @returns Its luminance, 0 to 1.
 */
function relativeLuminance(color: Rgba): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

/**
 * The luminance below which a frame's fill is dark: where the light theme's ink and the
 * dark theme's ink ({@link INK_COLORS}) have the same WCAG contrast against it, about 0.186. A
 * fill darker than it reads better with the dark mode's light ink, a lighter one with the light
 * mode's dark ink, so the split gives ink the higher of its two contrasts on every fill.
 */
export const FRAME_FILL_DARK_LUMINANCE =
  Math.sqrt(
    (relativeLuminance(INK_COLORS.light) + 0.05) * (relativeLuminance(INK_COLORS.dark) + 0.05),
  ) - 0.05;

/**
 * The least alpha a frame's fill has to decide the mode: a fill at least half opaque
 * is mostly what shows behind the content; a fainter one is skipped, and the frame behind it
 * decides.
 */
export const FRAME_FILL_MIN_ALPHA = 0.5;

/** What the frame-fill rule resolves token fills with. */
export interface FrameFillModeOptions {
  /** The viewer's theme: the mode of a token fill no frame above decides. */
  readonly viewerTheme: ColorMode;
  /** The board's token values by id (a `TokenTable` serves); absent for the built-in defaults. */
  readonly tokens?: ReadonlyMap<string, TokenValues>;
  /**
   * What ink draws as per mode where the board has not edited the `ink` token: the viewer's ink
   * colours, as the renderer draws the frame with them. Default {@link INK_COLORS}.
   */
  readonly inkColors?: TokenValues;
}

/** The frame-fill rule's answer, with what it read. */
export interface FrameFillMode {
  /** The mode the nearest deciding fill gives; undefined when no fill decides. */
  readonly mode: ColorMode | undefined;
  /**
   * Whether a token fill was resolved in the viewer's theme, and no opaque fixed fill nearer
   * hides it: a theme switch may change `mode`.
   */
  readonly didReadViewerTheme: boolean;
  /**
   * The tokens the fills named, but those an opaque fixed fill nearer hides: an edit of one may
   * change `mode`.
   */
  readonly tokens: readonly string[];
}

/**
 * The fill a container shows behind its content: a frame's background; nothing for any other
 * object (mains and instances have no fill of their own).
 *
 * @param object - An ancestor.
 * @returns Its fill, or null.
 */
export function backdropFillOf(object: BoardObject): Paint | null {
  return object.type === 'frame' ? object.background : null;
}

/**
 * A token's values as the renderer draws them (`ColorPalette`): the table's entry, else a
 * built-in's defaults; `ink`, and a token the board lacks, the board's edited ink, else the
 * viewer's ink colours.
 *
 * @param id - The token id.
 * @param options - The board's token values and the viewer's ink colours.
 * @returns The values.
 */
function tokenValues(id: string, options: FrameFillModeOptions): TokenValues {
  const entry = options.tokens?.get(id);
  if (entry !== undefined) return entry;
  if (id !== INK && isBuiltinToken(id)) return BUILTIN_TOKEN_DEFAULTS[id];
  return options.tokens?.get(INK) ?? options.inkColors ?? INK_COLORS;
}

/**
 * Tells whether a value is a colour tuple of four finite numbers.
 *
 * @param value - Anything.
 * @returns True for a readable tuple.
 */
function isRgba(value: unknown): value is Rgba {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((channel) => typeof channel === 'number' && Number.isFinite(channel))
  );
}

/**
 * The one colour a stored fill shows, read defensively (a peer's raw write may hold anything): a
 * tuple as is, a gradient its average; nothing for an image paint or an unreadable value.
 *
 * @param fill - The fill as stored.
 * @returns The straight-alpha colour, or undefined.
 */
function readableColorOf(fill: unknown): Rgba | undefined {
  if (isRgba(fill)) return fill;
  const paint = fill as Paint | null;
  if (!isGradient(paint) || !Array.isArray(paint.stops) || paint.stops.length === 0) {
    return undefined;
  }
  const stops: readonly unknown[] = paint.stops;
  return stops.every(isReadableStop) ? paintAverageColor(paint) : undefined;
}

/**
 * Tells whether a stored gradient stop can be read: an offset and a colour tuple.
 *
 * @param stop - The stop as stored.
 * @returns True when readable.
 */
function isReadableStop(stop: unknown): boolean {
  if (typeof stop !== 'object' || stop === null) return false;
  const { offset, color } = stop as { readonly offset?: unknown; readonly color?: unknown };
  return typeof offset === 'number' && isRgba(color);
}

/**
 * Composites a straight-alpha colour over an opaque one.
 *
 * @param top - The colour above.
 * @param below - The opaque colour below.
 * @returns The opaque result.
 */
function over(top: Rgba, below: Rgba): Rgba {
  const alpha = top[3];
  const channel = (index: 0 | 1 | 2) => top[index] * alpha + below[index] * (1 - alpha);
  return [channel(0), channel(1), channel(2), 1];
}

/**
 * The frame-fill rule over the fills behind an object, nearest first: evaluated from
 * the outermost in, each fill resolved in the mode the fills above it give (the viewer's theme at
 * the top). A token fill is its value in that mode; a gradient its stops' mean weighted by their
 * spans (`paintAverageColor`); an image paint, an absent fill and a fill under
 * {@link FRAME_FILL_MIN_ALPHA} decide nothing. A deciding fill is composited over the one that
 * decided above it (an outermost one is taken as opaque, so a frame's mode never depends on the
 * viewer's canvas), and gives `dark` below {@link FRAME_FILL_DARK_LUMINANCE}, else `light`. Pure.
 *
 * @param fills - The fills of the object's ancestors, nearest first (null for none).
 * @param options - The viewer's theme and the board's token values.
 * @returns The mode, if any fill decided, and what was read.
 */
export function frameFillModeOf(
  fills: readonly (Paint | null)[],
  options: FrameFillModeOptions,
): FrameFillMode {
  let mode: ColorMode | undefined;
  let below: Rgba | undefined;
  let didReadViewerTheme = false;
  const tokens: string[] = [];
  for (let index = fills.length - 1; index >= 0; index -= 1) {
    const fill = fills[index] ?? null;
    let color: Rgba | undefined;
    if (isTokenRef(fill)) {
      tokens.push(fill.token);
      if (mode === undefined) didReadViewerTheme = true;
      color = tokenValues(fill.token, options)[mode ?? options.viewerTheme];
    } else {
      color = readableColorOf(fill);
      // An opaque fixed fill hides every fill above it: what they read no longer matters.
      if (color !== undefined && color[3] >= 1) {
        tokens.length = 0;
        didReadViewerTheme = false;
      }
    }
    if (color === undefined || color[3] < FRAME_FILL_MIN_ALPHA) continue;
    below = below === undefined ? [color[0], color[1], color[2], 1] : over(color, below);
    mode = relativeLuminance(below) < FRAME_FILL_DARK_LUMINANCE ? 'dark' : 'light';
  }
  return { mode, didReadViewerTheme, tokens };
}

/**
 * The frame-fill rule for an object of a board: {@link frameFillModeOf} over the fills
 * of its ancestors, walked as `effectiveColorMode` walks them (virtual content through its
 * instance). Meant as `effectiveColorMode`'s `fallbackMode`, asked only when no ancestor sets a
 * `colorMode`; an explicit mode it passes is not read. Pure.
 *
 * @param object - The object: stored, or virtual content of an instance.
 * @param board - The board.
 * @param options - The viewer's theme and the board's token values.
 * @returns The mode, or undefined when no filled frame decides (the viewer's theme applies).
 */
export function frameFillColorMode(
  object: BoardObject,
  board: ColorModeBoard,
  options: FrameFillModeOptions,
): ColorMode | undefined {
  return frameFillModeOf(colorModeAncestors(object, board).map(backdropFillOf), options).mode;
}

/**
 * The frame-fill rule as `effectiveColorMode`'s `fallbackMode` hook, for one viewer and table.
 *
 * @param options - The viewer's theme and the board's token values.
 * @returns The hook.
 */
export function frameFillFallback(options: FrameFillModeOptions): ColorModeFallback {
  return (object, board) => frameFillColorMode(object, board, options);
}

/**
 * The fill a container shows behind its own text: a sticky's colour, a shape's fill;
 * nothing for any other object (a frame's fill decides for its children, not its title).
 *
 * @param object - An object of any type.
 * @returns Its fill, or null.
 */
export function containerFillOf(object: BoardObject): Paint | null {
  if (object.type === 'sticky') return object.color;
  return object.type === 'shape' ? object.fill : null;
}

/**
 * The mode a filled container's theme-default text draws in: its own fill
 * ({@link containerFillOf}), resolved in the mode the object draws its fill in and judged as
 * {@link frameFillModeOf} judges a frame's, so `'ink'` and every token in its text are dark on a
 * light fill and light on a dark one whatever the theme or an ancestor's `colorMode`. A colour
 * tuple in the text is not changed by it. Pure.
 *
 * @param object - The object.
 * @param fillMode - The mode its fill draws in (`effectiveColorMode`, else the viewer's theme).
 * @param options - The board's token values and the viewer's ink colours.
 * @returns The mode, or undefined when the object is no container or its fill decides nothing
 *   (no fill, an image, under {@link FRAME_FILL_MIN_ALPHA}): its text draws in `fillMode`.
 */
export function containerTextMode(
  object: BoardObject,
  fillMode: ColorMode,
  options: Omit<FrameFillModeOptions, 'viewerTheme'> = {},
): ColorMode | undefined {
  const fill = containerFillOf(object);
  if (fill === null) return undefined;
  return frameFillModeOf([fill], { ...options, viewerTheme: fillMode }).mode;
}

/** The modes an object draws in for one viewer: its fill's and strokes', and its own text's. */
export interface DrawnColorModes {
  /** The mode its fill, strokes and children's fallback draw in (`effectiveColorMode`). */
  readonly fill: ColorMode;
  /** The mode its theme-default text draws in ({@link containerTextMode}, else `fill`). */
  readonly text: ColorMode;
}

/**
 * The modes an object draws in as the board draws it for one viewer: its colour mode
 * with the frame-fill rule as the fallback, and the mode its own fill gives a sticky's
 * or filled shape's text. What a vector export, the clipboard and the caret read, so text leaves
 * the board in the colours it is drawn in. Pure.
 *
 * @param object - The object: stored, or virtual content of an instance.
 * @param board - The board.
 * @param options - The viewer's theme (light for an export, which has none) and the board's
 *   token values.
 * @returns The modes.
 */
export function drawnColorModes(
  object: BoardObject,
  board: ColorModeBoard,
  options: FrameFillModeOptions,
): DrawnColorModes {
  const fill = effectiveColorMode(object, board, {
    viewerTheme: options.viewerTheme,
    fallbackMode: frameFillFallback(options),
  });
  // The text's fill is judged in the mode it draws in, not the viewer's theme.
  return { fill, text: containerTextMode(object, fill, options) ?? fill };
}
