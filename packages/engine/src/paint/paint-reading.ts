import {
  INK,
  isGradient,
  isImagePaint,
  isTokenRef,
  paintReason,
  type BoardObject,
  type Gradient,
  type ImagePaint,
  type ResolvedPaint,
  type Rgba,
  type StyleRun,
} from '@canvas/schema';
import { BASE_COLOR, readInkable } from '@canvas/text';

import { LINK_CARD_TOKENS } from '../shapes/link-card-geometry.js';

import { LIGHT_PALETTE, tokenIdOf, type ColorPalette } from './color-palette.js';

// The engine's tolerant reader of paints and inkable colours: replays from storage and peers
// that skipped the relay's door reach the engine unjudged, so a value the schema refuses never
// reaches a GPU record. A refused gradient draws as no fill (the stroke and label still draw); a
// stroke or text colour that is neither a tuple nor exactly `'ink'` or a valid token reference
// draws in the base colour. Tuples are judged by the drawable gate as before. Tokens and `'ink'`
// resolve in the record's palette. The base colour and the inkable reader live in
// @canvas/text, whose layout reads text colours.

export { BASE_COLOR, readInkable };

/** Gradients already judged, by value: objects are immutable values, so a change is a new one. */
const judgedGradients = new WeakMap<object, boolean>();

/**
 * Whether a value is a gradient the schema accepts (`paintReason`), memoised per value.
 *
 * @param value - A non-array object.
 * @returns True when it is a valid gradient.
 */
function isReadableGradient(value: object): boolean {
  let isReadable = judgedGradients.get(value);
  if (isReadable === undefined) {
    isReadable = paintReason(value) === undefined;
    judgedGradients.set(value, isReadable);
  }
  return isReadable;
}

/**
 * Reads a stored fill or frame background as the engine draws it: `null` and absent are no fill;
 * a tuple is a solid paint (its numbers are the drawable gate's); a colour token reference
 * is a solid paint, its value in the palette (a token fill is always a fill, whatever
 * it resolves to); a gradient or an image paint is read only when the schema accepts
 * it, and anything else (a refused gradient, a string) draws as no fill. Pure.
 *
 * @param value - The stored value.
 * @param palette - What tokens resolve to; default the light theme's built-ins (enough to tell
 *   whether there is a fill).
 * @returns The paint, or null for no fill.
 */
export function readFill(
  value: unknown,
  palette: ColorPalette = LIGHT_PALETTE,
): ResolvedPaint | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value as Rgba;
  if (typeof value !== 'object') return null;
  if (isTokenRef(value)) return palette.tokenColor(value.token);
  return isReadableGradient(value) ? (value as ResolvedPaint) : null;
}

/**
 * Reads a stored fill as a gradient: the gradient when {@link readFill} gives one, else
 * undefined (a solid, no fill, or an unreadable value). Pure.
 *
 * @param value - The stored value.
 * @returns The gradient, or undefined.
 */
export function readGradient(value: unknown): Gradient | undefined {
  const paint = readFill(value);
  return isGradient(paint) ? paint : undefined;
}

/**
 * Reads a stored fill or frame background as an image paint: the paint when
 * {@link readFill} gives one, else undefined (a solid, a gradient, no fill, or an unreadable
 * value). Pure.
 *
 * @param value - The stored value.
 * @returns The image paint, or undefined.
 */
export function readImagePaint(value: unknown): ImagePaint | undefined {
  const paint = readFill(value);
  return isImagePaint(paint) ? paint : undefined;
}

/**
 * Reads a stored solid colour (a sticky's): a tuple as is, a colour token reference
 * its value in the palette, anything else the {@link BASE_COLOR}. Pure.
 *
 * @param value - The stored value.
 * @param palette - What tokens resolve to; default the light theme's built-ins.
 * @returns The straight-alpha colour to write.
 */
export function readSolid(value: unknown, palette: ColorPalette = LIGHT_PALETTE): Rgba {
  if (Array.isArray(value)) return value as Rgba;
  return isTokenRef(value) ? palette.tokenColor(value.token) : BASE_COLOR;
}

/**
 * Resolves a stored stroke or text colour in a palette: `'ink'` and a token reference are their
 * values in it, a tuple stays, an unreadable value is the {@link BASE_COLOR}. Pure.
 *
 * @param value - The stored value.
 * @param palette - The record's palette (`SceneObject.palette`); default the light theme's.
 * @returns The straight-alpha colour to write.
 */
export function drawnColor(value: unknown, palette: ColorPalette = LIGHT_PALETTE): Rgba {
  const color = readInkable(value);
  return Array.isArray(color) ? color : palette.resolve(color);
}

/**
 * Whether any run of a text draws in `'ink'`, a linked one included.
 *
 * @param runs - The runs, or undefined.
 * @returns True when one does.
 */
function hasInkRun(runs: readonly StyleRun[] | undefined): boolean {
  return runs?.some((run) => run.style.color === INK) === true;
}

/**
 * Whether an object draws anything in `'ink'`: a stroke (shape outline, line, connector, path)
 * or a text run (text, sticky, shape or connector label). The scene keeps such objects, so a
 * theme switch rewrites only their records. Pure.
 *
 * @param object - The object.
 * @returns True when one of its colours is the ink token.
 */
export function usesInk(object: BoardObject): boolean {
  if ('stroke' in object && object.stroke?.color === INK) return true;
  if ('runs' in object && hasInkRun(object.runs)) return true;
  return 'label' in object && object.label !== null && hasInkRun(object.label.runs);
}

/**
 * Adds the token a run list's colours name.
 *
 * @param runs - The runs, or undefined.
 * @param found - The ids found so far, or undefined.
 * @returns The ids, or undefined when none is named.
 */
function runTokens(
  runs: readonly StyleRun[] | undefined,
  found: Set<string> | undefined,
): Set<string> | undefined {
  if (runs === undefined) return found;
  let ids = found;
  for (const run of runs) ids = withToken(run.style.color, ids);
  return ids;
}

/**
 * Adds the token a colour names, if it names one.
 *
 * @param value - A stored colour.
 * @param found - The ids found so far, or undefined.
 * @returns The ids, or undefined when none is named.
 */
function withToken(value: unknown, found: Set<string> | undefined): Set<string> | undefined {
  if (Array.isArray(value) || value === null || value === undefined) return found;
  const id = tokenIdOf(value);
  if (id === undefined) return found;
  const ids = found ?? new Set<string>();
  ids.add(id);
  return ids;
}

/**
 * The colour tokens an object draws with: `'ink'` for the literal, each reference's id,
 * across its stroke, fill or frame background, sticky colour, text and label runs, and a link
 * card's built-ins; undefined
 * when it names none, which is most objects, so a scene keeps only the others for a token edit,
 * a theme switch or a mode change. Allocates only when one is named. Pure.
 *
 * @param object - The object.
 * @returns The ids, or undefined.
 */
export function colorTokensOf(object: BoardObject): ReadonlySet<string> | undefined {
  let ids: Set<string> | undefined;
  if ('stroke' in object && object.stroke !== null && object.stroke !== undefined) {
    ids = withToken(object.stroke.color, ids);
  }
  if ('fill' in object) ids = withToken(object.fill, ids);
  if (object.type === 'frame') ids = withToken(object.background, ids);
  if (object.type === 'sticky') ids = withToken(object.color, ids);
  // A link card draws with the built-ins its look names (`LINK_CARD_TOKENS`).
  if (object.type === 'link') ids = new Set([...(ids ?? []), ...LINK_CARD_TOKENS]);
  if ('runs' in object) ids = runTokens(object.runs, ids);
  if ('label' in object && object.label !== null) ids = runTokens(object.label.runs, ids);
  return ids;
}
