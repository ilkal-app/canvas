import type { BoardObject, StyleRun } from '@canvas/schema';
import { LINE_HEIGHT_EM } from '@canvas/text';

import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import { TEXT_LOD_RULE } from '../../lod/lod-thresholds.js';

import { textPlacementOf } from './text-placement.js';

/**
 * The height of an object's tallest line of text, world units: its largest font size ×
 * `LINE_HEIGHT_EM`, so no line greys or hides while a larger one would still be drawn. Any object
 * `textPlacementOf` places text for is measured (text objects, sticky notes, and shape labels once
 * they register there), so each kind of text adopts the text rule by registering its placement.
 * 0 for an object without text or without runs. Pure.
 *
 * @param object - The object.
 * @returns The line height, world units.
 */
export function textLineHeightOf(object: BoardObject): number {
  const geometry = textPlacementOf(object);
  let largest = 0;
  for (const { style } of geometry?.runs ?? []) largest = Math.max(largest, style.fontSize);
  return largest * LINE_HEIGHT_EM;
}

/**
 * The text pass's level-of-detail rule: an object's text draws
 * as greyed bars while its tallest line is under 4 device pixels and is left out under 2.5, each
 * threshold with a 20% band (`TEXT_LOD_RULE`). It replaces's rule, which left a sticky
 * note's text out under 3 device pixels with no band.
 */
export const TEXT_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: TEXT_LOD_RULE,
  sizeOf: textLineHeightOf,
  isSameSize: isSameTextSize,
};

/**
 * Whether two versions of a text object, a sticky note or a shape's label have the same tallest
 * line without placing their text: the same type and the same largest font size (a shape
 * without a label measures 0 either way). False for any other type, which is measured again
 * through `textPlacementOf` (a kind that registers its placement there extends this check to
 * skip the measure on a move). Pure.
 *
 * @param previous - The version last measured.
 * @param next - The new version.
 * @returns True when the line height is sure to be the same.
 */
export function isSameTextSize(previous: BoardObject, next: BoardObject): boolean {
  if (previous.type === 'text' && next.type === 'text') {
    return largestFontSize(previous.runs) === largestFontSize(next.runs);
  }
  if (previous.type === 'sticky' && next.type === 'sticky') {
    return largestFontSize(previous.runs) === largestFontSize(next.runs);
  }
  if (
    (previous.type === 'shape' && next.type === 'shape') ||
    (previous.type === 'connector' && next.type === 'connector')
  ) {
    return largestFontSize(previous.label?.runs ?? []) === largestFontSize(next.label?.runs ?? []);
  }
  return false;
}

/**
 * The largest font size of some style runs.
 *
 * @param runs - The runs.
 * @returns The size, world units; 0 without runs.
 */
function largestFontSize(runs: readonly StyleRun[]): number {
  let largest = 0;
  for (const { style } of runs) largest = Math.max(largest, style.fontSize);
  return largest;
}
