import { DECORATION_KEYS } from '../font/decoration-metrics.js';
import type { FontFaceKey } from '../font/font-face.js';
import type { FontMetrics } from '../font/font-metrics.js';

// A face's metrics as one short string, so the bundled faces' tables ship as source (the agent
// surface has no font files). Every metric is an integer number of font units over
// `unitsPerEm`, as the font stores it, so decoding divides the same integers by the same number
// as the parser did and gives back exactly its values. Numbers are base 36; fields are separated
// by `;`, groups by `|`, entries by `,`:
//
//   unitsPerEm ; ascent ; descent ; missing advance ; advances ; kerning
//
// Advances are groups of consecutive codepoints, `start:advance,advance,…`, the start written as
// the gap from the previous group's end. Kerning is grouped by left codepoint,
// `left:right=adjustment,…`, each left and right written as the gap from the one before.

const RADIX = 36;

/**
 * Writes an integer in base 36, a minus sign in front of a negative one.
 *
 * @param value - The integer.
 * @returns Its text.
 */
function write(value: number): string {
  return value.toString(RADIX);
}

/**
 * Reads an integer {@link write} wrote.
 *
 * @param text - Its text.
 * @returns The integer.
 * @throws {RangeError} When the text is not one.
 */
function read(text: string): number {
  const value = Number.parseInt(text, RADIX);
  if (!Number.isInteger(value) || write(value) !== text) {
    throw new RangeError(`Bad number "${text}" in encoded face metrics.`);
  }
  return value;
}

/**
 * Converts a length in em back to the font units it was read from.
 *
 * @param em - The length, in em.
 * @param unitsPerEm - The font's units per em.
 * @returns The integer number of units.
 */
function unitsOf(em: number, unitsPerEm: number): number {
  return Math.round(em * unitsPerEm);
}

/**
 * Encodes a face's full metrics table.
 *
 * @param metrics - The metrics `createFontMetrics` built; advances and kerning sorted.
 * @param unitsPerEm - The font's units per em, which its em values are units over.
 * @returns The encoded text.
 */
export function encodeFaceMetrics(metrics: FontMetrics, unitsPerEm: number): string {
  const units = (em: number): string => write(unitsOf(em, unitsPerEm));
  const advanceGroups: string[] = [];
  let previous = 0;
  let group: string[] = [];
  let groupEnd = -1;
  for (const [codepoint, advance] of metrics.advances) {
    if (codepoint !== groupEnd + 1 || group.length === 0) {
      if (group.length > 0) advanceGroups.push(group.join(','));
      group = [`${write(codepoint - previous)}:${units(advance)}`];
    } else group.push(units(advance));
    groupEnd = codepoint;
    previous = codepoint;
  }
  if (group.length > 0) advanceGroups.push(group.join(','));
  const kerningGroups: string[] = [];
  let previousLeft = 0;
  let previousRight = 0;
  let pairs: string[] = [];
  let groupLeft: number | undefined;
  for (const [left, right, adjustment] of metrics.kerning) {
    if (left !== groupLeft) {
      if (groupLeft !== undefined) {
        kerningGroups.push(`${write(groupLeft - previousLeft)}:${pairs.join(',')}`);
        previousLeft = groupLeft;
      }
      groupLeft = left;
      pairs = [];
      previousRight = 0;
    }
    pairs.push(`${write(right - previousRight)}=${units(adjustment)}`);
    previousRight = right;
  }
  if (groupLeft !== undefined) {
    kerningGroups.push(`${write(groupLeft - previousLeft)}:${pairs.join(',')}`);
  }
  return [
    write(unitsPerEm),
    units(metrics.ascent),
    units(metrics.descent),
    units(metrics.missingAdvance),
    advanceGroups.join('|'),
    kerningGroups.join('|'),
    ...(hasDecoration(metrics) ? [decorationField(metrics, units)] : []),
  ].join(';');
}

/**
 * Whether a face gives any decoration metrics.
 *
 * @param metrics - The face's metrics.
 * @returns True when one is set.
 */
function hasDecoration(metrics: FontMetrics): boolean {
  return DECORATION_KEYS.some((key) => metrics[key] !== undefined);
}

/**
 * The seventh field: the four decoration metrics, comma-separated, empty for one the
 * font does not give.
 *
 * @param metrics - The face's metrics.
 * @param units - Writes a length in em as font units.
 * @returns The field.
 */
function decorationField(metrics: FontMetrics, units: (em: number) => string): string {
  return DECORATION_KEYS.map((key) => {
    const value = metrics[key];
    return value === undefined ? '' : units(value);
  }).join(',');
}

/**
 * Decodes a face's metrics table {@link encodeFaceMetrics} wrote. Pure.
 *
 * @param face - The face the table describes.
 * @param encoded - The encoded text.
 * @returns The metrics, exactly as `createFontMetrics` built them from the font.
 * @throws {RangeError} When the text is not an encoded table.
 */
export function decodeFaceMetrics(face: FontFaceKey, encoded: string): FontMetrics {
  const fields = encoded.split(';');
  if (fields.length !== 6 && fields.length !== 7) {
    throw new RangeError('Encoded face metrics need six or seven fields.');
  }
  const [
    upem = '',
    ascent = '',
    descent = '',
    missing = '',
    advanceText = '',
    kernText = '',
    decorationText,
  ] = fields;
  const unitsPerEm = read(upem);
  const em = (text: string): number => read(text) / unitsPerEm;
  const advances: [number, number][] = [];
  let codepoint = 0;
  for (const group of advanceText === '' ? [] : advanceText.split('|')) {
    const [start = '', ...rest] = group.split(':');
    const values = rest.join(':').split(',');
    codepoint += read(start);
    values.forEach((value, offset) => {
      advances.push([codepoint + offset, em(value)]);
    });
    codepoint += values.length - 1;
  }
  const kerning: [number, number, number][] = [];
  let left = 0;
  for (const group of kernText === '' ? [] : kernText.split('|')) {
    const [leftText = '', pairText = ''] = group.split(':');
    left += read(leftText);
    let right = 0;
    for (const pair of pairText.split(',')) {
      const [rightText = '', adjustment = ''] = pair.split('=');
      right += read(rightText);
      kerning.push([left, right, em(adjustment)]);
    }
  }
  const decoration: Partial<Record<(typeof DECORATION_KEYS)[number], number>> = {};
  (decorationText?.split(',') ?? []).forEach((value, index) => {
    const key = DECORATION_KEYS[index];
    if (key !== undefined && value !== '') decoration[key] = em(value);
  });
  return {
    face,
    ascent: em(ascent),
    descent: em(descent),
    ...decoration,
    missingAdvance: em(missing),
    advances,
    kerning,
  };
}
