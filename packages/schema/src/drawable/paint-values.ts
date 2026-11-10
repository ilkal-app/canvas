import { INK } from '../fields/color.js';
import { MAX_GRADIENT_STOPS, MAX_RADIAL_RADIUS, MIN_GRADIENT_STOPS } from '../fields/paint.js';
import { MAX_STROKE_WIDTH } from '../fields/stroke.js';
import { isTokenRef } from '../fields/token-ref.js';
import { CROP_EDGE_SLACK } from '../objects/image-object.js';

import type { UndrawableReason } from './drawable-extent.js';

// The door's judgement of paints and strokes: the
// members of a `style` value a peer writes, judged as `paintSchema` and `strokeSchema` would
// accept them, from a value that may be anything. A plain value reaches the door, never a parsed
// one, so each check is by hand, cheap and names the first field at fault. Pure.

/** Why a paint or stroke is refused: a number out of range, or a value of the wrong shape. */
export type PaintValueReason = UndrawableReason | 'not-a-number' | 'not-a-record';

/** A field of a paint or stroke the door refuses. */
export interface PaintValueFinding {
  /** Where in the value, as a dotted path (`stops.3.offset`, `color`; `''` for the value). */
  readonly field: string;
  /** Why it is refused. */
  readonly reason: PaintValueReason;
}

/** A range a number must lie in. */
interface Range {
  readonly min: number;
  readonly max: number;
  readonly isMinOpen?: boolean;
}

const UNIT: Range = { min: 0, max: 1 };
const ANGLE: Range = { min: -Math.PI, max: Math.PI, isMinOpen: true };
const RADIUS: Range = { min: 0, max: MAX_RADIAL_RADIUS, isMinOpen: true };
const WIDTH: Range = { min: 0, max: MAX_STROKE_WIDTH, isMinOpen: true };
const CROP_EXTENT: Range = { min: 0, max: 1, isMinOpen: true };

const LINEAR_KEYS = ['type', 'angle', 'stops'] as const;
const RADIAL_KEYS = ['type', 'center', 'radius', 'stops'] as const;
const IMAGE_KEYS = ['type', 'assetId', 'naturalSize', 'fit', 'crop'] as const;

/** An asset id: 1 to 128 letters, digits, `_` or `-` (`assetIdSchema`). */
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** How an image paint may lay its crop into the box (`imageFitSchema`). */
const IMAGE_FITS: ReadonlySet<unknown> = new Set(['fill', 'fit', 'crop', 'tile']);

/**
 * Tells whether a value is a plain record (not null, not an array).
 *
 * @param value - Anything.
 * @returns True for a plain record.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds a finding.
 *
 * @param path - The field's path.
 * @param reason - Why.
 * @returns The finding.
 */
function at(path: readonly (string | number)[], reason: PaintValueReason): PaintValueFinding {
  return { field: path.join('.'), reason };
}

/**
 * Judges a number against its range.
 *
 * @param value - The value.
 * @param range - Its range.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function numberFinding(
  value: unknown,
  range: Range,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (typeof value !== 'number') return at(path, 'not-a-number');
  if (!Number.isFinite(value)) return at(path, 'not-finite');
  const isBelow = range.isMinOpen === true ? value <= range.min : value < range.min;
  return isBelow || value > range.max ? at(path, 'out-of-range') : undefined;
}

/**
 * Tells whether a record holds exactly the given keys.
 *
 * @param record - The record.
 * @param keys - The keys it must hold, and no other.
 * @returns True when they match.
 */
function hasExactly(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

/**
 * Judges a colour tuple: four numbers in [0, 1].
 *
 * @param value - The value.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function tupleFinding(
  value: unknown,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (!Array.isArray(value) || value.length !== 4) return at(path, 'not-a-record');
  for (let channel = 0; channel < 4; channel += 1) {
    const finding = numberFinding((value as readonly unknown[])[channel], UNIT, [...path, channel]);
    if (finding !== undefined) return finding;
  }
  return undefined;
}

/**
 * Judges a gradient's stops: 2 to 8 strict `{ offset, color }` records, offsets in [0, 1] and
 * non-decreasing, colours tuples.
 *
 * @param stops - The value.
 * @returns The finding, or undefined.
 */
function stopsFinding(stops: unknown): PaintValueFinding | undefined {
  if (!Array.isArray(stops)) return at(['stops'], 'not-a-record');
  if (stops.length < MIN_GRADIENT_STOPS || stops.length > MAX_GRADIENT_STOPS) {
    return at(['stops'], 'out-of-range');
  }
  let previous = 0;
  for (const [index, stop] of (stops as readonly unknown[]).entries()) {
    if (!isRecord(stop) || !hasExactly(stop, ['offset', 'color'])) {
      return at(['stops', index], 'not-a-record');
    }
    const finding =
      numberFinding(stop.offset, UNIT, ['stops', index, 'offset']) ??
      tupleFinding(stop.color, ['stops', index, 'color']);
    if (finding !== undefined) return finding;
    const offset = stop.offset as number;
    if (offset < previous) return at(['stops', index, 'offset'], 'out-of-range');
    previous = offset;
  }
  return undefined;
}

/**
 * Judges a record that claims to be a token reference: exactly `{ token }` with a valid
 * token id. Whether the board has that token is not the door's question: an unknown token draws
 * as ink and is a board issue (`unknown-color-token`).
 *
 * @param value - The record.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function tokenRefFinding(
  value: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (!hasExactly(value, ['token'])) return at(path, 'not-a-record');
  return isTokenRef(value) ? undefined : at([...path, 'token'], 'out-of-range');
}

/**
 * Judges a colour that may be a token reference: a tuple, or a token reference.
 *
 * @param value - The value.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function colorFinding(
  value: unknown,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (isRecord(value) && Object.hasOwn(value, 'token')) return tokenRefFinding(value, path);
  return tupleFinding(value, path);
}

/**
 * Judges a gradient object.
 *
 * @param gradient - The record.
 * @returns The finding, or undefined.
 */
function gradientFinding(
  gradient: Readonly<Record<string, unknown>>,
): PaintValueFinding | undefined {
  if (gradient.type === 'linear') {
    if (!hasExactly(gradient, LINEAR_KEYS)) return at([], 'not-a-record');
    return numberFinding(gradient.angle, ANGLE, ['angle']) ?? stopsFinding(gradient.stops);
  }
  if (gradient.type !== 'radial' || !hasExactly(gradient, RADIAL_KEYS)) {
    return at([], 'not-a-record');
  }
  const { center } = gradient;
  if (!isRecord(center) || !hasExactly(center, ['x', 'y'])) return at(['center'], 'not-a-record');
  return (
    numberFinding(center.x, UNIT, ['center', 'x']) ??
    numberFinding(center.y, UNIT, ['center', 'y']) ??
    numberFinding(gradient.radius, RADIUS, ['radius']) ??
    stopsFinding(gradient.stops)
  );
}

/**
 * Judges a pixel count: a whole number above 0.
 *
 * @param value - The value.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function pixelsFinding(
  value: unknown,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (typeof value !== 'number') return at(path, 'not-a-number');
  if (!Number.isFinite(value)) return at(path, 'not-finite');
  return Number.isInteger(value) && value > 0 ? undefined : at(path, 'out-of-range');
}

/**
 * Judges an image paint's crop: its corner in the unit square, its size in (0, 1], and the
 * rectangle within the image (`cropReason`'s rules, `CROP_EDGE_SLACK` included), reporting the
 * extent that runs past the image.
 *
 * @param crop - The value.
 * @returns The finding, or undefined.
 */
function cropFinding(crop: unknown): PaintValueFinding | undefined {
  if (!isRecord(crop) || !hasExactly(crop, ['x', 'y', 'width', 'height'])) {
    return at(['crop'], 'not-a-record');
  }
  const finding =
    numberFinding(crop.x, UNIT, ['crop', 'x']) ??
    numberFinding(crop.y, UNIT, ['crop', 'y']) ??
    numberFinding(crop.width, CROP_EXTENT, ['crop', 'width']) ??
    numberFinding(crop.height, CROP_EXTENT, ['crop', 'height']);
  if (finding !== undefined) return finding;
  const { x, y, width, height } = crop as Record<'x' | 'y' | 'width' | 'height', number>;
  if (x + width > 1 + CROP_EDGE_SLACK) return at(['crop', 'width'], 'out-of-range');
  if (y + height > 1 + CROP_EDGE_SLACK) return at(['crop', 'height'], 'out-of-range');
  return undefined;
}

/**
 * Judges an image paint: exactly `{ type, assetId, naturalSize, fit, crop }`, an asset
 * id, a whole positive natural size, a known fit and a crop within the image.
 *
 * @param paint - The record, `type: 'image'`.
 * @returns The finding, or undefined.
 */
function imageFinding(paint: Readonly<Record<string, unknown>>): PaintValueFinding | undefined {
  if (!hasExactly(paint, IMAGE_KEYS)) return at([], 'not-a-record');
  if (typeof paint.assetId !== 'string' || !ASSET_ID.test(paint.assetId)) {
    return at(['assetId'], 'out-of-range');
  }
  const { naturalSize } = paint;
  if (!isRecord(naturalSize) || !hasExactly(naturalSize, ['width', 'height'])) {
    return at(['naturalSize'], 'not-a-record');
  }
  return (
    pixelsFinding(naturalSize.width, ['naturalSize', 'width']) ??
    pixelsFinding(naturalSize.height, ['naturalSize', 'height']) ??
    (IMAGE_FITS.has(paint.fit) ? undefined : at(['fit'], 'out-of-range')) ??
    cropFinding(paint.crop)
  );
}

/**
 * The door's judgement of a fill or a frame's background as a peer wrote it:
 * absent, null, a colour tuple of four numbers in [0, 1], a token reference `{ token }` with a
 * valid id, a gradient `paintSchema` accepts (2 to 8 stops, offsets in [0, 1] and
 * non-decreasing, an angle in (−π, π], a centre in the unit box, a radius in (0, 2], no unknown
 * key), or an image paint (an asset id, a whole positive natural size, a known fit, a
 * crop within the image, no unknown key). Anything else is refused, `ink` included. Which objects
 * may hold an image paint (shapes and frames, not paths) is the object schema's rule. Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The first refused field, or undefined when the paint is acceptable.
 */
export function paintReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return tupleFinding(value, []);
  if (!isRecord(value)) return at([], 'not-a-record');
  if (Object.hasOwn(value, 'token')) return tokenRefFinding(value, []);
  return value.type === 'image' ? imageFinding(value) : gradientFinding(value);
}

/**
 * The door's judgement of a stroke as a peer wrote it: absent, null, or a
 * strict `{ color, width }` with `color` a tuple of four numbers in [0, 1], exactly `'ink'` or a
 * token reference, and `width` in (0, 64]. Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The first refused field, or undefined when the stroke is acceptable.
 */
export function strokeValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !hasExactly(value, ['color', 'width'])) return at([], 'not-a-record');
  const finding = value.color === INK ? undefined : colorFinding(value.color, ['color']);
  return finding ?? numberFinding(value.width, WIDTH, ['width']);
}
