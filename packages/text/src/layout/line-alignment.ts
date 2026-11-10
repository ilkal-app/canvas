import { SPACE } from './codepoints.js';
import type { PlacedGlyph } from './line-breaking.js';
import type { StackedLine } from './line-metrics.js';
import { noIndent } from './list-layout.js';
import type { LayoutLine, TextAlign } from './text-layout.js';

/**
 * The width a line shows: a soft-wrapped line ends in the space it broke at, which hangs past
 * the text and is not counted; a hard line keeps its trailing spaces, since the user typed them.
 *
 * @param stacked - The line and its glyphs.
 * @returns The visible width, in world units.
 */
function visibleWidth(stacked: StackedLine): number {
  if (stacked.line.isHard) return stacked.line.width;
  let width = 0;
  for (const glyph of stacked.lineGlyphs) {
    if (glyph.codepoint !== SPACE) width = glyph.x + glyph.advance;
  }
  return width;
}

/**
 * The side a line aligns to: `start` and `end` are left and right in a left-to-right paragraph
 * (an even level) and the reverse in a right-to-left one.
 *
 * @param align - The alignment.
 * @param level - The line's paragraph level.
 * @returns Its physical alignment.
 */
function physicalAlign(align: TextAlign, level: number): 'left' | 'center' | 'right' {
  if (align !== 'start' && align !== 'end') return align;
  const isRightToLeft = level % 2 === 1;
  return (align === 'start') === isRightToLeft ? 'right' : 'left';
}

/**
 * Offsets each line for an alignment (the prototype's centring pass, extended to right
 * alignment): lines centre or right-align inside `maxWidth`, or inside the widest line when the
 * box has no wrapping width. An overlong line is clamped to the left edge. A list paragraph's
 * lines align in the room its indent leaves, the indent on the paragraph's start side:
 * the left of a left-to-right paragraph, the right of a right-to-left one.
 *
 * @param lines - The stacked lines.
 * @param align - The alignment.
 * @param maxWidth - The wrapping width, or `null` for auto-width text.
 * @param width - The widest line's width.
 * @param levelAt - The paragraph level at a line's first index, for `start` and `end`.
 * @param indentAt - The indent of the paragraph a line starts in; none by default.
 * @returns Each line with its offset, and its glyphs (still relative to the line's start).
 */
export function alignLines(
  lines: readonly StackedLine[],
  align: TextAlign,
  maxWidth: number | null,
  width: number,
  levelAt: (start: number) => number,
  indentAt: (start: number) => number = noIndent,
): { readonly line: LayoutLine; readonly lineGlyphs: readonly PlacedGlyph[] }[] {
  const available = maxWidth ?? width;
  return lines.map((stacked) => {
    const level = levelAt(stacked.line.start);
    const indent = indentAt(stacked.line.start);
    const side = physicalAlign(align, level);
    const share = side === 'center' ? 0.5 : 1;
    const room = available - indent;
    const offset = side === 'left' ? 0 : Math.max(0, (room - visibleWidth(stacked)) * share);
    const x = level % 2 === 0 ? offset + indent : offset;
    return { line: { ...stacked.line, x }, lineGlyphs: stacked.lineGlyphs };
  });
}
