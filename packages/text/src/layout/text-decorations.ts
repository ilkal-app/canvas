import type { GlyphMeasurer, LineMetrics } from './glyph-measurer.js';
import type { LayoutDecoration, LayoutGlyph, LayoutLine, LayoutRun } from './text-layout.js';

/**
 * What a face that gives no decoration metrics draws with, in em: stroke tops, as the
 * font tables give them, for an underline centred 0.1 em below the baseline and a strikethrough
 * 0.3 em above it, each 0.05 em thick.
 */
const FALLBACK = {
  underlinePosition: -0.075,
  underlineThickness: 0.05,
  strikeoutPosition: 0.325,
  strikeoutThickness: 0.05,
} as const;

const KINDS = ['underline', 'strikethrough'] as const;

/**
 * Whether a codepoint is whitespace, which a line's end does not decorate.
 *
 * @param codepoint - The character.
 * @returns True for whitespace.
 */
function isWhitespace(codepoint: number): boolean {
  return /\s/u.test(String.fromCodePoint(codepoint));
}

/**
 * A decoration's centre and thickness for a run, from its face's metrics or the fallbacks: the
 * tables give the stroke's top, so its centre is half its thickness lower.
 *
 * @param kind - Underline or strikethrough.
 * @param metrics - The face's line metrics.
 * @param fontSize - The run's font size.
 * @returns The offset above the baseline and the thickness, in world units.
 */
function placementOf(
  kind: LayoutDecoration['kind'],
  metrics: LineMetrics,
  fontSize: number,
): { readonly above: number; readonly thickness: number } {
  const isUnderline = kind === 'underline';
  const position = isUnderline
    ? (metrics.underlinePosition ?? FALLBACK.underlinePosition)
    : (metrics.strikeoutPosition ?? FALLBACK.strikeoutPosition);
  const thickness = isUnderline
    ? (metrics.underlineThickness ?? FALLBACK.underlineThickness)
    : (metrics.strikeoutThickness ?? FALLBACK.strikeoutThickness);
  return { above: (position - thickness / 2) * fontSize, thickness: thickness * fontSize };
}

/**
 * The underline and strikethrough segments of laid-out text: per line and kind, one
 * segment for each stretch of visually adjacent glyphs of one run that carries the flag.
 * Whitespace at a line's logical end is left out, so no line hangs past the words. Pure.
 *
 * @param lines - The laid-out lines.
 * @param glyphs - The placed glyphs, in board space within the box.
 * @param runs - The layout runs, with their decoration flags.
 * @param measurer - The faces' line metrics.
 * @returns The segments, line by line, underlines before strikethroughs within a line.
 */
export function decorationsOf(
  lines: readonly LayoutLine[],
  glyphs: readonly LayoutGlyph[],
  runs: readonly LayoutRun[],
  measurer: GlyphMeasurer,
): LayoutDecoration[] {
  if (!runs.some((run) => run.underline === true || run.strikethrough === true)) return [];
  const byLine = lines.map((): LayoutGlyph[] => []);
  for (const glyph of glyphs) byLine[glyph.line]?.push(glyph);
  const decorations: LayoutDecoration[] = [];
  byLine.forEach((lineGlyphs, lineIndex) => {
    const line = lines[lineIndex];
    if (line === undefined) return;
    let inkEnd = -1;
    for (const glyph of lineGlyphs) {
      if (!isWhitespace(glyph.codepoint)) inkEnd = Math.max(inkEnd, glyph.end);
    }
    const visual = lineGlyphs.filter((glyph) => glyph.index < inkEnd).sort((a, b) => a.x - b.x);
    for (const kind of KINDS) {
      let stretch: LayoutGlyph[] = [];
      const close = () => {
        const first = stretch[0];
        const last = stretch.at(-1);
        const run = first === undefined ? undefined : runs[first.run];
        if (first !== undefined && last !== undefined && run !== undefined) {
          const { above, thickness } = placementOf(
            kind,
            measurer.lineMetrics(run.faceId),
            run.fontSize,
          );
          decorations.push({
            kind,
            line: lineIndex,
            run: first.run,
            x: first.x,
            width: last.x + last.advance - first.x,
            y: line.baseline - above,
            thickness,
          });
        }
        stretch = [];
      };
      for (const glyph of visual) {
        const isMarked = runs[glyph.run]?.[kind] === true;
        if (stretch.length > 0 && (!isMarked || stretch[0]?.run !== glyph.run)) close();
        if (isMarked) stretch.push(glyph);
      }
      close();
    }
  });
  return decorations;
}
