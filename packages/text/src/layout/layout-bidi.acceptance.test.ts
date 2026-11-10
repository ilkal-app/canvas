/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';
import { lineBreakOpportunities } from '../line-break/line-breaks.js';
import { loadShaper, type ShapedRun } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';
import type { TextDirection } from '../shaping/text-direction.js';

import { createMetricsMeasurer, type GlyphMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';
import type { LayoutGlyph, TextLayout } from './text-layout.js';

const FONT_FILES = {
  'DM Sans': '../../../app/assets/fonts/library/dmsans/400.ttf',
  'Noto Sans Hebrew': '../../../app/assets/fonts/script-coverage/notosanshebrew/400.ttf',
  'Noto Sans Arabic': '../../../app/assets/fonts/script-coverage/notosansarabic/400.ttf',
} as const;
type Family = keyof typeof FONT_FILES;

/**
 * Loads a real checked-in face and its metrics for shaping.
 *
 * @param family - Font family.
 * @returns Its bytes and parsed metrics.
 */
function font(family: Family): {
  bytes: Uint8Array;
  metrics: ReturnType<typeof createFontMetrics>;
} {
  const bytes = readFileSync(new URL(FONT_FILES[family], import.meta.url));
  return {
    bytes,
    metrics: createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes)),
  };
}

/**
 * Makes one style run for each supplied text stretch.
 *
 * @param stretches - Text and covering font for each stretch.
 * @returns Consecutive style runs.
 */
function runs(...stretches: readonly [text: string, family: Family][]): StyleRun[] {
  return stretches.map(([text, family]) => {
    const style: TextStyle = {
      fontFamily: family,
      fontSize: 20,
      color: [0, 0, 0, 1],
      weight: 400,
      italic: false,
    };
    return { length: text.length, style };
  });
}

/**
 * Creates a shaping measurer with all three real script faces.
 *
 * @returns The HarfBuzz measurer.
 */
async function measurer(): Promise<GlyphMeasurer> {
  return createShapingMeasurer(await loadShaper(), [
    font('DM Sans'),
    font('Noto Sans Hebrew'),
    font('Noto Sans Arabic'),
  ]);
}

/**
 * Returns the glyph at a source index, failing clearly if coverage is missing.
 *
 * @param layout - The layout to search.
 * @param index - UTF-16 source index.
 * @returns The glyph covering the index.
 * @throws {Error} When the source index has no glyph.
 */
function glyphAt(layout: TextLayout, index: number): LayoutGlyph {
  const glyph = layout.glyphs.find((candidate) => candidate.index === index);
  if (glyph === undefined) throw new Error(`No glyph at UTF-16 index ${String(index)}`);
  return glyph;
}

/**
 * Returns the leftmost and rightmost glyph origins of a logical source range.
 *
 * @param layout - The layout to search.
 * @param start - Range start.
 * @param end - Exclusive range end.
 * @returns The glyph origin extent.
 * @throws {Error} When the range has no glyphs.
 */
function extent(layout: TextLayout, start: number, end: number): [number, number] {
  const positions = layout.glyphs
    .filter((glyph) => glyph.index >= start && glyph.index < end)
    .map((glyph) => glyph.x);
  if (positions.length === 0) throw new Error('No glyphs in source range');
  return [Math.min(...positions), Math.max(...positions)];
}

/**
 * Reads the embedding level required of a layout glyph by bidi layout.
 *
 * @param glyph - A positioned glyph.
 * @returns Its embedding level.
 */
function levelOf(glyph: LayoutGlyph): number {
  return (glyph as LayoutGlyph & { readonly level: number }).level;
}

describe('layoutText bidirectional shaping', () => {
  it('lets layout explicitly select HarfBuzz shaping direction', async () => {
    const shaping = await measurer();
    const shape = shaping.shape as
      | ((
          faceId: string,
          text: string,
          start: number,
          end: number,
          direction?: TextDirection,
        ) => ShapedRun)
      | undefined;
    if (shape === undefined) throw new Error('Shaping measurer has no shape method');
    const style = runs(['abc', 'DM Sans'])[0]?.style;
    if (style === undefined) throw new Error('Missing style run');
    const faceId = shaping.faceIdOf(style);
    const defaultRun = shape(faceId, 'abc', 0, 3);
    const forcedRun = shape(faceId, 'abc', 0, 3, 'rtl');
    expect(defaultRun.direction).toBe('ltr');
    expect(forcedRun.direction).toBe('rtl');
    expect(forcedRun.glyphs.map((glyph) => glyph.cluster)).toEqual([2, 1, 0]);
  });

  it('places an embedded Hebrew word between Latin words and reverses its glyphs', async () => {
    const text = 'Hello שלום world';
    const layout = layoutText(
      text,
      runs(['Hello ', 'DM Sans'], ['שלום', 'Noto Sans Hebrew'], [' world', 'DM Sans']),
      null,
      await measurer(),
    );
    expect(layout.lines).toHaveLength(1);
    expect(extent(layout, 0, 5)[1]).toBeLessThan(extent(layout, 6, 10)[0]);
    expect(extent(layout, 6, 10)[1]).toBeLessThan(extent(layout, 11, 16)[0]);
    expect(glyphAt(layout, 6).x).toBeGreaterThan(glyphAt(layout, 9).x);
    expect(
      layout.glyphs.filter((glyph) => glyph.index < 6 || glyph.index >= 10).map(levelOf),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(
      layout.glyphs.filter((glyph) => glyph.index >= 6 && glyph.index < 10).map(levelOf),
    ).toEqual([1, 1, 1, 1]);
  });

  it('resolves an automatic RTL paragraph with a left-to-right Latin island', async () => {
    const text = 'שלום Hello עולם';
    const layout = layoutText(
      text,
      runs(['שלום ', 'Noto Sans Hebrew'], ['Hello', 'DM Sans'], [' עולם', 'Noto Sans Hebrew']),
      null,
      await measurer(),
    );
    expect(glyphAt(layout, 0).x).toBeGreaterThan(extent(layout, 5, 10)[1]);
    expect(extent(layout, 11, 15)[1]).toBeLessThan(extent(layout, 5, 10)[0]);
    expect(glyphAt(layout, 0).x).toBe(Math.max(...layout.glyphs.map((glyph) => glyph.x)));
    expect(glyphAt(layout, 5).x).toBeLessThan(glyphAt(layout, 6).x);
    expect(
      layout.glyphs
        .filter((glyph) => glyph.index >= 5 && glyph.index < 10)
        .every((glyph) => levelOf(glyph) === 2),
    ).toBe(true);
    expect(
      layout.glyphs
        .filter((glyph) => [0, 1, 2, 3, 11, 12, 13, 14].includes(glyph.index))
        .every((glyph) => levelOf(glyph) === 1),
    ).toBe(true);
  });

  it('places English to the left of Arabic in an automatic RTL paragraph', async () => {
    const layout = layoutText(
      'مرحبا Hello',
      runs(['مرحبا ', 'Noto Sans Arabic'], ['Hello', 'DM Sans']),
      null,
      await measurer(),
    );
    expect(extent(layout, 6, 11)[1]).toBeLessThan(extent(layout, 0, 5)[0]);
    expect(glyphAt(layout, 6).x).toBeLessThan(glyphAt(layout, 7).x);
    expect(
      layout.glyphs.filter((glyph) => glyph.index < 5).every((glyph) => levelOf(glyph) === 1),
    ).toBe(true);
    expect(
      layout.glyphs.filter((glyph) => glyph.index >= 6).every((glyph) => levelOf(glyph) === 2),
    ).toBe(true);
  });

  it('keeps European digits in left-to-right order to the left of Hebrew', async () => {
    const layout = layoutText(
      'שלום 123',
      runs(['שלום ', 'Noto Sans Hebrew'], ['123', 'DM Sans']),
      null,
      await measurer(),
    );
    expect(glyphAt(layout, 5).x).toBeLessThan(glyphAt(layout, 6).x);
    expect(glyphAt(layout, 6).x).toBeLessThan(glyphAt(layout, 7).x);
    expect(extent(layout, 5, 8)[1]).toBeLessThan(extent(layout, 0, 4)[0]);
    expect(
      layout.glyphs.filter((glyph) => glyph.index >= 5).every((glyph) => levelOf(glyph) === 2),
    ).toBe(true);
  });

  it('uses HarfBuzz mirrored glyph IDs for parentheses in an RTL run', async () => {
    const shaping = await measurer();
    const rtl = layoutText('א(ב)ג', runs(['א(ב)ג', 'Noto Sans Hebrew']), null, shaping);
    const ltr = layoutText('(b)', runs(['(b)', 'Noto Sans Hebrew']), null, shaping);
    expect(glyphAt(rtl, 1).glyphId).toBe(glyphAt(ltr, 2).glyphId);
    expect(glyphAt(rtl, 3).glyphId).toBe(glyphAt(ltr, 0).glyphId);
    expect(glyphAt(rtl, 1).glyphId).not.toBe(glyphAt(ltr, 0).glyphId);
  });

  it('wraps an RTL paragraph at legal boundaries and hangs trailing spaces left', async () => {
    const text = 'שלום עולם גדול שלום עולם גדול שלום עולם גדול';
    const styleRuns = runs([text, 'Noto Sans Hebrew']);
    const shaping = await measurer();
    const maxWidth =
      layoutText('שלום עולם ', runs(['שלום עולם ', 'Noto Sans Hebrew']), null, shaping).width + 1;
    const layout = layoutText(text, styleRuns, maxWidth, shaping);
    const legal = new Set(lineBreakOpportunities(text).map(({ index }) => index));
    expect(layout.lines.length).toBeGreaterThan(2);
    for (const [number, line] of layout.lines.entries()) {
      if (number > 0) {
        expect(line.start).toBe(layout.lines[number - 1]?.end);
        expect(legal.has(line.start)).toBe(true);
      }
      const glyphs = layout.glyphs.filter((glyph) => glyph.line === number);
      expect(glyphs.every((glyph) => glyph.index >= line.start && glyph.end <= line.end)).toBe(
        true,
      );
      const visible = glyphs.filter((glyph) => glyph.codepoint !== 0x20);
      expect(visible.length).toBeGreaterThan(0);
      expect(Math.min(...visible.map((glyph) => glyph.x))).toBeGreaterThanOrEqual(-0.5);
      expect(Math.max(...visible.map((glyph) => glyph.x + glyph.advance))).toBeLessThanOrEqual(
        maxWidth + 0.5,
      );
      expect(levelOf(glyphAt(layout, visible[0]?.index ?? -1))).toBe(1);
      expect(visible.find((glyph) => glyph.index === line.start)?.x).toBe(
        Math.max(...visible.map((glyph) => glyph.x)),
      );
      if (!line.isHard) {
        const trailing = glyphs.filter(
          (glyph) => glyph.codepoint === 0x20 && glyph.index >= line.end - 1,
        );
        expect(trailing.length).toBeGreaterThan(0);
        expect(trailing.every((glyph) => glyph.x < 0)).toBe(true);
        expect(Math.min(...visible.map((glyph) => glyph.x))).toBeCloseTo(0, 1);
      }
    }
  });

  it.each([
    ['Hello world', null],
    ['The quick brown fox jumps over the lazy dog', 110],
    ['One two three four five six seven eight', 75],
  ] as const)('preserves ASCII shaping and wrapping for %s', async (text, maxWidth) => {
    const shaping = await measurer();
    const originalShape = shaping.shape;
    if (originalShape === undefined) throw new Error('Shaping measurer has no shape method');
    const ignoresDirection: GlyphMeasurer = {
      ...shaping,
      shape: (faceId, source, start, end) => originalShape(faceId, source, start, end),
    };
    const styleRuns = runs([text, 'DM Sans']);
    const layout = layoutText(text, styleRuns, maxWidth, shaping);
    const baseline = layoutText(text, styleRuns, maxWidth, ignoresDirection);
    expect(layout).toEqual(baseline);
    expect(layout.glyphs.every((glyph) => levelOf(glyph) === 0)).toBe(true);
    for (const [number] of layout.lines.entries()) {
      const glyphs = layout.glyphs.filter((glyph) => glyph.line === number);
      expect(
        glyphs.every(
          (glyph, index) => index === 0 || glyph.x > (glyphs[index - 1]?.x ?? -Infinity),
        ),
      ).toBe(true);
    }
  });

  it('marks every glyph from the metrics fallback with level zero', () => {
    const text = 'Hello שלום';
    const metrics = createMetricsMeasurer([
      font('DM Sans').metrics,
      font('Noto Sans Hebrew').metrics,
    ]);
    const layout = layoutText(
      text,
      runs(['Hello ', 'DM Sans'], ['שלום', 'Noto Sans Hebrew']),
      null,
      metrics,
    );
    expect(layout.glyphs).toHaveLength(text.length);
    expect(layout.glyphs.map(levelOf)).toEqual(Array.from({ length: text.length }, () => 0));
  });

  it('moves an RTL word whole to the next line of an LTR paragraph', async () => {
    const shaping = await measurer();
    const maxWidth = layoutText('Hello ', runs(['Hello ', 'DM Sans']), null, shaping).width + 5;
    const layout = layoutText(
      'Hello שלום',
      runs(['Hello ', 'DM Sans'], ['שלום', 'Noto Sans Hebrew']),
      maxWidth,
      shaping,
    );
    expect(layout.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 6],
      [6, 10],
    ]);
    expect(
      layout.glyphs
        .filter((glyph) => glyph.index >= 6)
        .every((glyph) => glyph.line === 1 && levelOf(glyph) === 1),
    ).toBe(true);
    expect(glyphAt(layout, 6).x).toBeGreaterThan(glyphAt(layout, 9).x);
  });
});
