import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';
import { loadShaper, shapeText } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { layoutText } from './layout-text.js';

const SIZE = 20;

/**
 * A regular style in a family.
 *
 * @param family - The family.
 * @param fontSize - The size.
 * @returns The style.
 */
function style(family: string, fontSize = SIZE): TextStyle {
  return { fontFamily: family, fontSize, color: [0, 0, 0, 1], weight: 400, italic: false };
}

/**
 * One run over a text.
 *
 * @param text - The text.
 * @param textStyle - Its style.
 * @returns The runs.
 */
function one(text: string, textStyle: TextStyle): StyleRun[] {
  return [{ length: text.length, style: textStyle }];
}

describe('layout over shaped text', () => {
  it('ends a line at each hard break, empty lines and a final newline included', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [acceptanceFont('eb-garamond')]);
    const text = 'off\n\nice\n';
    const layout = layoutText(text, one(text, style('EB Garamond')), null, measurer);
    expect(layout.lines.map(({ start, end, isHard }) => [start, end, isHard])).toEqual([
      [0, 3, true],
      [4, 4, true],
      [5, 8, true],
      [9, 9, true],
    ]);
    expect(layout.glyphs.map(({ index, end, line }) => [index, end, line])).toEqual([
      [0, 1, 0],
      [1, 3, 0],
      [5, 6, 2],
      [6, 7, 2],
      [7, 8, 2],
    ]);
  });

  it('ends a line once at a CR LF pair, which LB5 keeps together', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [acceptanceFont('eb-garamond')]);
    const text = 'off\r\nice';
    const layout = layoutText(text, one(text, style('EB Garamond')), null, measurer);
    expect(layout.lines.map(({ start, end, isHard }) => [start, end, isHard])).toEqual([
      [0, 3, true],
      [5, 8, true],
    ]);
  });

  it('wraps back to a space in an earlier segment when a later one overflows', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [acceptanceFont('eb-garamond')]);
    const text = 'office office';
    // A size change makes "offi" and "ce office" separate segments.
    const runs: StyleRun[] = [
      { length: 9, style: style('EB Garamond') },
      { length: 4, style: style('EB Garamond', 40) },
    ];
    const whole = layoutText(text, runs, null, measurer);
    const firstWord = whole.glyphs.filter(({ index }) => index < 7);
    const width = Math.max(...firstWord.map(({ x, advance }) => x + advance)) + 1;
    const layout = layoutText(text, runs, width, measurer);
    // The first line ends at the space, in the first segment; the 40 px word wraps on its own.
    expect(layout.lines[0]).toMatchObject({ start: 0, end: 7, isHard: false });
    expect(layout.lines[1]?.start).toBe(7);
    expect(layout.glyphs.filter(({ line }) => line === 0).map(({ index }) => index)).toEqual([
      0, 1, 4, 5, 6,
    ]);
  });

  it('breaks a word too long for the line between clusters, each side shaped as its own stretch', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('noto-sans-arabic');
    const measurer = createShapingMeasurer(shaper, [font]);
    const text = 'بالعالم';
    const textStyle = style('Noto Sans Arabic');
    const whole = layoutText(text, one(text, textStyle), null, measurer);
    const layout = layoutText(text, one(text, textStyle), whole.width / 2, measurer);
    expect(layout.lines.length).toBeGreaterThan(1);
    const face = shaper.face('Noto Sans Arabic|400|normal', font.bytes);
    for (const [line, { start, end }] of layout.lines.entries()) {
      const placed = layout.glyphs.filter((glyph) => glyph.line === line);
      // Each side is shaped on its own, with the rest of the word as context.
      const stretch = shapeText(shaper, face, text, start, end);
      expect(placed.map(({ glyphId }) => glyphId)).toEqual(
        stretch.glyphs.map(({ glyphId }) => glyphId),
      );
    }
  });

  it('hangs a wrapped right-to-left line’s trailing space on its left, so alignment centres its letters', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [
      acceptanceFont('noto-sans-arabic'),
    ]);
    const text = 'مرحبا بالعالم';
    const runs = one(text, style('Noto Sans Arabic'));
    const firstWord = layoutText('مرحبا', one('مرحبا', style('Noto Sans Arabic')), null, measurer);
    const maxWidth = firstWord.width + 10;
    const layout = layoutText(text, runs, maxWidth, measurer, 'center');
    const [first] = layout.lines;
    expect(first).toMatchObject({ start: 0, end: 6, isHard: false });
    const letters = layout.glyphs.filter(({ line, codepoint }) => line === 0 && codepoint !== 0x20);
    const left = Math.min(...letters.map(({ x }) => x));
    const right = Math.max(...letters.map(({ x, advance }) => x + advance));
    // The letters sit centred in the box; the space hangs left of them.
    expect(left).toBeCloseTo(maxWidth - right, 6);
    const space = layout.glyphs.find(({ line, codepoint }) => line === 0 && codepoint === 0x20);
    expect(space?.x).toBeLessThan(left);
  });

  it('never cuts a word inside a grapheme HarfBuzz splits into clusters', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [
      acceptanceFont('noto-sans-devanagari'),
    ]);
    // HarfBuzz shapes the conjunct "स्ते" as clusters [2,4) and [4,6); it is one grapheme [2,6).
    const text = 'नमस्ते';
    const graphemeStarts = new Set(
      [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
        ({ index }) => index,
      ),
    );
    const textStyle = style('Noto Sans Devanagari');
    const whole = layoutText(text, one(text, textStyle), null, measurer).width;
    let cuts = 0;
    for (let maxWidth = 1; maxWidth < whole; maxWidth += 0.5) {
      const layout = layoutText(text, one(text, textStyle), maxWidth, measurer);
      for (const line of layout.lines.slice(1)) {
        cuts += 1;
        expect(graphemeStarts.has(line.start), `a line starts at ${String(line.start)}`).toBe(true);
      }
    }
    expect(cuts).toBeGreaterThan(0);
  });

  it('never cuts inside a grapheme a style change splits', async () => {
    const font = acceptanceFont('liberation-sans');
    const measurer = createShapingMeasurer(await loadShaper(), [font]);
    // Each "a" and its combining acute get their own size, so every character is its own segment
    // and every grapheme spans two.
    const text = 'a\u0301'.repeat(6);
    const runs: StyleRun[] = [];
    for (let index = 0; index < text.length; index += 1) {
      runs.push({ length: 1, style: style(font.metrics.face.family, SIZE + (index % 2)) });
    }
    const whole = layoutText(text, runs, null, measurer).width;
    let cuts = 0;
    for (let maxWidth = 1; maxWidth < whole; maxWidth += 0.5) {
      const layout = layoutText(text, runs, maxWidth, measurer);
      for (const line of layout.lines.slice(1)) {
        cuts += 1;
        expect(line.start % 2, `a line starts at ${String(line.start)}`).toBe(0);
      }
    }
    expect(cuts).toBeGreaterThan(0);
  });
});
