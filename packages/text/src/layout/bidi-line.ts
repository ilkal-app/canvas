// One line's clusters in visual order: each cluster takes its first character's bidi
// level, rule L1 sends the line's trailing whitespace (and any before a tab) back to the
// paragraph's level, and rule L2 reverses the runs at each odd level and above. A cluster keeps
// its glyphs in HarfBuzz's order, so a grapheme (a surrogate pair included) never splits.

import { bidiClassOf } from '../bidi/bidi-class.js';
import { lineLevels, visualOrder } from '../bidi/bidi-levels.js';
import { elementAt } from '../line-break/element-at.js';

import { codepointAt } from './codepoints.js';
import type { Cluster } from './shaped-clusters.js';
import type { TextBidi } from './text-bidi.js';

/**
 * A line's items in visual order, left to right, with their levels after L1.
 *
 * @param text - The whole text.
 * @param items - The line's items, in logical order, each with its cluster.
 * @param bidi - The text's bidi levels.
 * @param lineStart - The line's first UTF-16 index, which names its paragraph; the text's
 *   length for an empty last line.
 * @returns The items in visual order, and each one's level.
 */
export function orderLine<T extends { readonly cluster: Cluster }>(
  text: string,
  items: readonly T[],
  bidi: TextBidi,
  lineStart: number,
): { items: T[]; levels: number[] } {
  // An empty line, such as the one after a final newline, may start at the text's end.
  if (items.length === 0) return { items: [], levels: [] };
  const levels = items.map(({ cluster }) => elementAt(bidi.levels, cluster.start));
  const classes = items.map(({ cluster }) =>
    bidiClassOf(codepointAt(text, cluster.start).codepoint),
  );
  const resolved = lineLevels(levels, classes, elementAt(bidi.paragraphLevels, lineStart));
  const order = visualOrder(resolved);
  const ordered: T[] = [];
  const orderedLevels: number[] = [];
  for (const index of order) {
    ordered.push(elementAt(items, index));
    orderedLevels.push(elementAt(resolved, index));
  }
  return { items: ordered, levels: orderedLevels };
}
