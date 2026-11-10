import { SPACE } from '@canvas/text';
import type { CaretRect, LayoutLine, LineExtent, TextLayout } from '@canvas/text';

// Caret and hit-testing helpers over a TextLayout, ported from the prototype's
// `src/text/layout.ts`. Indices are UTF-16 caret positions (0 to text.length); coordinates are
// world units in the box's frame.

const EMPTY_LINE: LayoutLine = {
  start: 0,
  end: 0,
  isHard: true,
  x: 0,
  y: 0,
  height: 0,
  ascent: 0,
  descent: 0,
  baseline: 0,
  width: 0,
};

function lineAt(layout: TextLayout, lineIndex: number): LayoutLine {
  return layout.lines[lineIndex] ?? EMPTY_LINE;
}

/**
 * The line a caret index sits on. A caret at a wrap point belongs to the next line; at a hard
 * line's end (its newline) it stays on that line.
 *
 * @param layout - The laid-out text.
 * @param index - A caret index.
 * @returns The line index; the last line for an index past the end.
 */
export function lineOf(layout: TextLayout, index: number): number {
  const lastLine = layout.lines.length - 1;
  const found = layout.lines.findIndex(
    (line, lineIndex) =>
      index < line.end || (index === line.end && (line.isHard || lineIndex === lastLine)),
  );
  return found >= 0 ? found : lastLine;
}

/**
 * The caret index that visually ends a line: before the space a soft line wrapped at.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns The caret index.
 */
export function lineEndIndex(layout: TextLayout, lineIndex: number): number {
  const line = lineAt(layout, lineIndex);
  const isEndingInWrapSpace =
    !line.isHard && line.end > line.start && layout.text.charCodeAt(line.end - 1) === SPACE;
  return isEndingInWrapSpace ? line.end - 1 : line.end;
}

/**
 * Where to draw the caret for an index.
 *
 * @param layout - The laid-out text.
 * @param index - A caret index.
 * @param extent - The caret's extent around the baseline (sized to a style); the whole line box
 *   when omitted.
 * @returns The caret's position and height.
 */
export function caretRect(layout: TextLayout, index: number, extent?: LineExtent): CaretRect {
  const line = lineAt(layout, lineOf(layout, index));
  const glyph =
    index < line.end ? layout.glyphs.find((candidate) => candidate.index === index) : undefined;
  const x = glyph?.x ?? line.x + line.width;
  if (extent === undefined) return { x, y: line.y, height: line.height };
  return { x, y: line.baseline - extent.ascent, height: extent.ascent + extent.descent };
}

/**
 * The caret index nearest an x on a line: before the first glyph whose middle is right of x.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @param x - The x, in world units.
 * @returns The caret index.
 */
export function indexAtLine(layout: TextLayout, lineIndex: number, x: number): number {
  const glyph = layout.glyphs.find(
    (candidate) => candidate.line === lineIndex && x < candidate.x + candidate.advance / 2,
  );
  return glyph?.index ?? lineEndIndex(layout, lineIndex);
}

/**
 * The line whose box contains a y, clamped to the first and last lines.
 *
 * @param layout - The laid-out text.
 * @param y - The y, in world units.
 * @returns The line index.
 */
export function lineAtY(layout: TextLayout, y: number): number {
  let low = 0;
  let high = layout.lines.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const line = lineAt(layout, middle);
    if (y < line.y + line.height) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The caret index nearest a point in the box.
 *
 * @param layout - The laid-out text.
 * @param point - The point, in the box's frame.
 * @param point.x - Its x, in world units.
 * @param point.y - Its y, in world units.
 * @returns The caret index.
 */
export function hitTest(
  layout: TextLayout,
  point: { readonly x: number; readonly y: number },
): number {
  return indexAtLine(layout, lineAtY(layout, point.y), point.x);
}
