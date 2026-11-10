import type { GlyphMeasurer } from './glyph-measurer.js';
import type { BrokenLine, PlacedGlyph } from './line-breaking.js';
import type { RunCursor } from './run-cursor.js';
import { LINE_HEIGHT_EM, type LayoutRun, type LineExtent } from './text-layout.js';

/**
 * The ascent and descent of a line box for one face at one size: {@link LINE_HEIGHT_EM} × the
 * size, or a set line-height, with the half-leading split evenly above and below (the
 * prototype's `lineExtent`). A line-height below the face's own gives negative half-leading.
 *
 * @param faceId - The face.
 * @param fontSize - The font size, in world units.
 * @param measurer - The face's line metrics.
 * @param lineHeight - The line box height, in world units; omitted for auto.
 * @returns The extent around the baseline, in world units.
 */
export function lineExtent(
  faceId: string,
  fontSize: number,
  measurer: GlyphMeasurer,
  lineHeight?: number,
): LineExtent {
  const { ascent, descent } = measurer.lineMetrics(faceId);
  const height = lineHeight ?? LINE_HEIGHT_EM * fontSize;
  const halfLeading = (height - (ascent + descent) * fontSize) / 2;
  return { ascent: ascent * fontSize + halfLeading, descent: descent * fontSize + halfLeading };
}

/** A broken line placed vertically, with the glyphs that sit on it. */
export interface StackedLine {
  /** The line, its box measured. */
  readonly line: BrokenLine & {
    /** Top of the line box. */
    readonly y: number;
    /** Height of the line box. */
    readonly height: number;
    /** Top of the box to the baseline. */
    readonly ascent: number;
    /** Baseline to the bottom of the box. */
    readonly descent: number;
    /** The baseline's y. */
    readonly baseline: number;
  };
  /** Its glyphs, in order. */
  readonly lineGlyphs: readonly PlacedGlyph[];
}

/**
 * Stacks the lines (the second pass of the prototype's `layoutText`): each line box is as tall
 * as the tallest run on it (each run's line-height); a line without glyphs takes the run of its newline, or the last run
 * for a trailing empty line.
 *
 * @param lines - The broken lines, top to bottom.
 * @param glyphs - The placed glyphs, in text order (so grouped by line).
 * @param cursor - The text's runs.
 * @param measurer - Line metrics.
 * @returns The stacked lines and the total height, in world units.
 */
export function stackLines(
  lines: readonly BrokenLine[],
  glyphs: readonly PlacedGlyph[],
  cursor: RunCursor<{ readonly run: LayoutRun }>,
  measurer: GlyphMeasurer,
): { readonly lines: readonly StackedLine[]; readonly height: number } {
  const extents = new Map<number, LineExtent>();
  const extentAt = (index: number): LineExtent => {
    const span = cursor.at(index);
    let extent = extents.get(span.index);
    if (extent === undefined) {
      const { faceId, fontSize, lineHeight } = span.value.run;
      extent = lineExtent(faceId, fontSize, measurer, lineHeight);
      extents.set(span.index, extent);
    }
    return extent;
  };
  const groups: PlacedGlyph[][] = lines.map(() => []);
  for (const glyph of glyphs) groups[glyph.line]?.push(glyph);
  let y = 0;
  const stacked = lines.map((line, lineIndex): StackedLine => {
    const lineGlyphs = groups[lineIndex] ?? [];
    const lineExtents =
      lineGlyphs.length > 0
        ? lineGlyphs.map(({ index }) => extentAt(index))
        : [extentAt(line.start)];
    const ascent = Math.max(...lineExtents.map((extent) => extent.ascent));
    const descent = Math.max(...lineExtents.map((extent) => extent.descent));
    const top = y;
    y += ascent + descent;
    const measured = {
      ...line,
      y: top,
      height: ascent + descent,
      ascent,
      descent,
      baseline: top + ascent,
    };
    return { line: measured, lineGlyphs };
  });
  return { lines: stacked, height: y };
}
