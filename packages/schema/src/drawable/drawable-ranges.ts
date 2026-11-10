import { INK } from '../fields/color.js';
import { LINE_CAPS } from '../fields/line-cap.js';
import type { Point } from '../fields/point.js';
import { MAX_STROKE_WIDTH } from '../fields/stroke.js';
import {
  LETTER_SPACING_LIMITS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MIN_FONT_SIZE,
  isFontWeight,
  type LetterSpacing,
  type LineHeight,
  type StyleRun,
} from '../fields/text-style.js';
import { isTokenRef, type TokenRef } from '../fields/token-ref.js';
import { CROP_EDGE_SLACK, type Crop } from '../objects/image-object.js';
import { INSTANCE_SCALE_MAX, INSTANCE_SCALE_MIN } from '../objects/instance-object.js';
import { MAX_SHAPE_SIDES } from '../objects/shape-object.js';

import { FLOAT32_MAX, MAX_DRAWABLE_SIZE, type UndrawableReason } from './drawable-extent.js';

// The ranges a drawn number must lie in: the one statement of them, read by the
// engine's reader of stored objects (`ownUndrawableReason`) and by the relay's door check of
// incoming values (`drawableValuesReason`), so the two can never disagree. Each returns the
// reason a number is out of its range, or undefined. Pure.

/** The line caps the path pass knows how to draw. */
const CAPS: ReadonlySet<string> = new Set(LINE_CAPS);

/**
 * Judges a stored coordinate (a placement, a line end, a path vertex or handle): finite only. A
 * stored coordinate is an offset in its parent's or its object's frame, which the board's bound
 * does not bound (a command honestly stores 1e308 as the `x` of an empty group it moved,
 * or of a line whose ends bring it back); where it lands on the board is judged with the object's
 * parents, by the engine's extent check, never at the relay's door, which sees one value.
 *
 * @param value - The coordinate, world units.
 * @returns `not-finite`, or undefined.
 */
export function coordinateReason(value: number): UndrawableReason | undefined {
  return Number.isFinite(value) ? undefined : 'not-finite';
}

/**
 * Judges a number with no narrower range (a rotation, a font weight, a free end, an offset):
 * finite, and within float32's range.
 *
 * @param value - The number.
 * @returns The reason, or undefined.
 */
export function scalarReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  return Math.abs(value) > FLOAT32_MAX ? 'out-of-range' : undefined;
}

/**
 * Judges a size with no bound in the schema (a width, a height, a corner radius): finite, at
 * least 0, at most `MAX_DRAWABLE_SIZE`.
 *
 * @param value - The size, world units.
 * @returns The reason, or undefined.
 */
export function sizeReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  if (value < 0) return 'negative-size';
  return value > MAX_DRAWABLE_SIZE ? 'past-extent' : undefined;
}

/**
 * Judges an instance's content scale: finite, from `INSTANCE_SCALE_MIN` to
 * `INSTANCE_SCALE_MAX`, as the schema requires; 0 would divide its box by zero.
 *
 * @param value - The scale.
 * @returns The reason, or undefined.
 */
export function instanceScaleReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  return value >= INSTANCE_SCALE_MIN && value <= INSTANCE_SCALE_MAX ? undefined : 'out-of-range';
}

/**
 * Judges an image's natural size, pixels: a whole number from 1 to `MAX_DRAWABLE_SIZE`, as the
 * schema requires. A fraction lets the image fit's aspect underflow to 0 / 0 (a natural size
 * and crop of 1e-200 write NaN into the image record).
 *
 * @param value - The size, pixels.
 * @returns The reason, or undefined.
 */
export function naturalSizeReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  if (value < 0) return 'negative-size';
  return Number.isInteger(value) && value >= 1 && value <= MAX_DRAWABLE_SIZE
    ? undefined
    : 'out-of-range';
}

/**
 * Judges a font size: the schema's range, `MIN_FONT_SIZE` to `MAX_FONT_SIZE` (4 to 400).
 *
 * @param value - The size, world px.
 * @returns The reason, or undefined.
 */
export function fontSizeReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  if (value < 0) return 'negative-size';
  return value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE ? undefined : 'out-of-range';
}

/**
 * Judges a fraction (a colour channel, an opacity, a crop's corner, an anchor): in [0, 1].
 *
 * @param value - The fraction.
 * @returns The reason, or undefined.
 */
export function unitReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  return value >= 0 && value <= 1 ? undefined : 'out-of-range';
}

/**
 * Judges a crop's width or height: in (0, 1]; 0 would make the image's scale infinite.
 *
 * @param value - The fraction.
 * @returns The reason, or undefined.
 */
export function cropExtentReason(value: number): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  if (value < 0) return 'negative-size';
  return value > 0 && value <= 1 ? undefined : 'out-of-range';
}

/**
 * Judges a crop: its corner in the unit square, its size in (0, 1], and the rectangle within the
 * image (its right and bottom edges at most 1, with `cropSchema`'s slack for sums like 0.1 + 0.9).
 *
 * @param crop - The crop, fractions of the image's natural size.
 * @returns The reason, or undefined.
 */
export function cropReason(crop: Crop): UndrawableReason | undefined {
  const reason =
    unitReason(crop.x) ??
    unitReason(crop.y) ??
    cropExtentReason(crop.width) ??
    cropExtentReason(crop.height);
  if (reason !== undefined) return reason;
  const isWithin =
    crop.x + crop.width <= 1 + CROP_EDGE_SLACK && crop.y + crop.height <= 1 + CROP_EDGE_SLACK;
  return isWithin ? undefined : 'out-of-range';
}

/**
 * Judges a point's coordinates as scalars.
 *
 * @param point - The point.
 * @returns The reason, or undefined.
 */
export function pointReason(point: Point): UndrawableReason | undefined {
  return scalarReason(point.x) ?? scalarReason(point.y);
}

/**
 * Judges a colour's channels, which a renderer writes to its GPU buffers: each in [0, 1]. The
 * `ink` token and a token reference with a valid id are resolved to fixed
 * colours before they are drawn; any other record is out of range.
 *
 * @param channels - The channels, `'ink'`, a token reference, or null for none.
 * @returns The reason, or undefined.
 */
export function colorReason(
  channels: readonly number[] | typeof INK | TokenRef | null,
): UndrawableReason | undefined {
  if (channels === null || channels === INK) return undefined;
  if (!Array.isArray(channels)) return isTokenRef(channels) ? undefined : 'out-of-range';
  for (const channel of channels as readonly number[]) {
    const reason = unitReason(channel);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

/**
 * Judges a stroke: its colour, and its width from 0 to the schema's `MAX_STROKE_WIDTH` (the
 * path pass's joins and caps are tessellated from it).
 *
 * @param stroke - The stroke, or null.
 * @param stroke.color - Its colour.
 * @param stroke.width - Its width, world units.
 * @returns The reason, or undefined.
 */
export function strokeReason(
  stroke: {
    readonly color: readonly number[] | typeof INK | TokenRef;
    readonly width: number;
  } | null,
): UndrawableReason | undefined {
  if (stroke === null) return undefined;
  const reason = colorReason(stroke.color) ?? sizeReason(stroke.width);
  if (reason !== undefined) return reason;
  return stroke.width > MAX_STROKE_WIDTH ? 'out-of-range' : undefined;
}

/**
 * Judges a polygon's sides or a star's points: an integer from 3 to the schema's
 * `MAX_SHAPE_SIDES` (64). The CPU walks that many vertices per hit test and label fit, and 0 sides
 * make the fit's centre NaN.
 *
 * @param sides - The count.
 * @returns The reason, or undefined.
 */
export function sidesReason(sides: number): UndrawableReason | undefined {
  if (!Number.isFinite(sides)) return 'not-finite';
  return Number.isInteger(sides) && sides >= 3 && sides <= MAX_SHAPE_SIDES
    ? undefined
    : 'out-of-range';
}

/**
 * Judges a line cap: one of the schema's `LINE_CAPS`, which the path pass draws.
 *
 * @param cap - The cap.
 * @returns The reason, or undefined.
 */
export function capReason(cap: string): UndrawableReason | undefined {
  return CAPS.has(cap) ? undefined : 'out-of-range';
}

/**
 * Judges a run's weight as the schema does: 100 to 900 in steps of 100.
 *
 * @param weight - The weight.
 * @returns The reason, or undefined.
 */
export function fontWeightReason(weight: number): UndrawableReason | undefined {
  if (!Number.isFinite(weight)) return 'not-finite';
  return isFontWeight(weight) ? undefined : 'out-of-range';
}

/**
 * Judges a run's letter-spacing as the schema does: none, or a finite value in its
 * unit's range.
 *
 * @param spacing - The letter-spacing, or undefined for none.
 * @returns The reason, or undefined.
 */
export function letterSpacingReason(
  spacing: LetterSpacing | undefined,
): UndrawableReason | undefined {
  if (spacing === undefined) return undefined;
  const { value, unit } = spacing as { readonly value: number; readonly unit: string };
  if (!Number.isFinite(value)) return 'not-finite';
  const limits = unit === 'px' || unit === 'percent' ? LETTER_SPACING_LIMITS[unit] : undefined;
  return limits !== undefined && value >= limits.min && value <= limits.max
    ? undefined
    : 'out-of-range';
}

/**
 * Judges a run's line-height as the schema does: auto, or a finite value above 0 and
 * at most its unit's maximum.
 *
 * @param height - The line-height, or undefined for auto.
 * @returns The reason, or undefined.
 */
export function lineHeightReason(height: LineHeight | undefined): UndrawableReason | undefined {
  if (height === undefined || height === 'auto') return undefined;
  if (typeof height !== 'object') return 'out-of-range';
  const { value, unit } = height as { readonly value: number; readonly unit: string };
  if (!Number.isFinite(value)) return 'not-finite';
  const max = unit === 'px' || unit === 'percent' ? MAX_LINE_HEIGHT[unit] : undefined;
  return max !== undefined && value > 0 && value <= max ? undefined : 'out-of-range';
}

/**
 * Judges a text's runs as the schema does: at least one; each run's font size, weight, colour,
 * letter-spacing and line-height; their lengths, which the layout walks character by character, whole numbers summing to
 * the text's length, a zero-length run only as the one run of an empty text. The text mode's
 * layout throws on a text with no run.
 *
 * @param content - The text, or null for none.
 * @returns The reason, or undefined.
 */
export function textRunsReason(
  content: { readonly text: string; readonly runs: readonly StyleRun[] } | null,
): UndrawableReason | undefined {
  if (content === null) return undefined;
  const { runs } = content;
  const isEmpty = content.text.length === 0;
  if (runs.length === 0 || (isEmpty && runs.length !== 1)) return 'out-of-range';
  let covered = 0;
  for (const { length, style } of runs) {
    const reason =
      coordinateReason(length) ??
      fontSizeReason(style.fontSize) ??
      fontWeightReason(style.weight) ??
      colorReason(style.color) ??
      letterSpacingReason(style.letterSpacing) ??
      lineHeightReason(style.lineHeight);
    if (reason !== undefined) return reason;
    if (!Number.isInteger(length) || length < 0 || (length === 0 && !isEmpty)) {
      return 'out-of-range';
    }
    covered += length;
  }
  return covered === content.text.length ? undefined : 'out-of-range';
}
