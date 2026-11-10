import type { Point } from '@canvas/schema';
import { SPACE, type LayoutGlyph, type LayoutRun, type TextLayout } from '@canvas/text';

import { GREEK_PAGE_RECT } from './greek-quads.js';
import type { PagedGlyphQuad } from './ordered-glyph-quads.js';

/** An underline's top below the baseline, as a fraction of the run's font size. */
const UNDERLINE_OFFSET = 0.1;

/** An underline's thickness, as a fraction of the run's font size; at least a device pixel. */
const UNDERLINE_THICKNESS = 0.06;

/** Two edges this close touch: one underline, no seam. */
const TOUCH = 1e-6;

/** A stretch of one line to underline, in visual order. */
interface Stretch {
  left: number;
  right: number;
  readonly fontSize: number;
  readonly color: LayoutRun['color'];
  readonly colorKey: string;
}

/** A link's underlines: flat quads (`GREEK_PAGE_RECT`) on page 0, appended after the glyphs. */
export interface LinkUnderlineQuads {
  /** One per stretch of linked text per line, left to right, lines top to bottom. */
  readonly quads: readonly PagedGlyphQuad[];
}

/**
 * A layout's glyphs by line, in one pass.
 *
 * @param layout - The laid-out text.
 * @returns Each line's glyphs, in layout order.
 */
function glyphsByLine(layout: TextLayout): LayoutGlyph[][] {
  const lines: LayoutGlyph[][] = layout.lines.map(() => []);
  for (const glyph of layout.glyphs) lines[glyph.line]?.push(glyph);
  return lines;
}

/**
 * The glyphs of a line that carry a link, without the spaces that end the line: a space inside a
 * link is underlined, one a line breaks after is not.
 *
 * @param layout - The laid-out text.
 * @param onLine - The line's glyphs.
 * @returns The line's linked glyphs.
 */
function linkedGlyphsOn(layout: TextLayout, onLine: readonly LayoutGlyph[]): LayoutGlyph[] {
  let lastInk = -1;
  for (const glyph of onLine) {
    if (glyph.codepoint !== SPACE) lastInk = Math.max(lastInk, glyph.index);
  }
  return onLine.filter(
    (glyph) => layout.runs[glyph.run]?.isLink === true && glyph.index <= lastInk,
  );
}

/**
 * Merges a line's linked glyph boxes into stretches: boxes that touch or overlap and draw in the
 * same colour at the same size are one stretch, so a word, or two links side by side, gets one
 * underline with no seam, while a change of size starts another, each at its own size's place
 * and thickness; bidi order is the glyphs' visual x, so a right-to-left link is
 * underlined where it shows.
 *
 * @param layout - The laid-out text.
 * @param glyphs - The line's linked glyphs.
 * @returns The stretches, left to right.
 */
function stretchesOf(layout: TextLayout, glyphs: readonly LayoutGlyph[]): Stretch[] {
  const boxes = glyphs
    .map((glyph) => ({ glyph, run: layout.runs[glyph.run] }))
    .filter((box): box is { glyph: LayoutGlyph; run: LayoutRun } => box.run !== undefined)
    .sort((a, b) => a.glyph.x - b.glyph.x);
  const stretches: Stretch[] = [];
  for (const { glyph, run } of boxes) {
    const left = glyph.x;
    const right = glyph.x + glyph.advance;
    const colorKey = JSON.stringify(run.color);
    const last = stretches.at(-1);
    if (
      last?.colorKey === colorKey &&
      last.fontSize === run.fontSize &&
      left <= last.right + TOUCH
    ) {
      last.right = Math.max(last.right, right);
      continue;
    }
    stretches.push({ left, right, fontSize: run.fontSize, color: run.color, colorKey });
  }
  return stretches.filter((stretch) => stretch.right - stretch.left > TOUCH);
}

/**
 * A text's link underlines: for each line, one flat bar under each stretch of linked
 * glyphs (`stretchesOf`), its top `0.1 em` below the baseline and `0.06 em` thick (at least a
 * device pixel), in the run's colour as its glyphs draw (ink included). The bars sample no page (`GREEK_PAGE_RECT`), as greek bars do, so
 * the text pass draws them flat in the same pass and order as the glyphs. Pure.
 *
 * @param layout - The laid-out text.
 * @param origin - Where the laid-out text starts in the object's frame (`textOriginOf`).
 * @param scale - Device pixels per world unit, which sets the thinnest bar.
 * @returns The bars; none for text without links.
 */
export function linkUnderlineQuads(
  layout: TextLayout,
  origin: Point,
  scale: number,
): LinkUnderlineQuads {
  if (!layout.runs.some((run) => run.isLink === true)) return { quads: [] };
  const [u0, v0, u1, v1] = GREEK_PAGE_RECT;
  const quads: PagedGlyphQuad[] = [];
  const byLine = glyphsByLine(layout);
  for (const [index, line] of layout.lines.entries()) {
    for (const stretch of stretchesOf(layout, linkedGlyphsOn(layout, byLine[index] ?? []))) {
      const height = Math.max(UNDERLINE_THICKNESS * stretch.fontSize, 1 / scale);
      quads.push({
        pageId: 0,
        quad: {
          x: origin.x + stretch.left,
          y: origin.y + line.baseline + UNDERLINE_OFFSET * stretch.fontSize,
          width: stretch.right - stretch.left,
          height,
          u0,
          v0,
          u1,
          v1,
          color: stretch.color,
        },
      });
    }
  }
  return { quads };
}
