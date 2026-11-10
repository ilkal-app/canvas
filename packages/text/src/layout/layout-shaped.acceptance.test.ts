import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createMetricsMeasurer } from '../index.js';
import {
  createShapingMeasurer,
  layoutText,
  loadShaper,
  shapeText,
} from '../shaping/__fixtures__/shaping-contract.js';
import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

const BLACK: [number, number, number, number] = [0, 0, 0, 1];
const RED: [number, number, number, number] = [1, 0, 0, 1];
const SIZE = 20;

/**
 * Makes a regular style for one of the checked-in test fonts.
 *
 * @param family - The font family.
 * @returns A style with fixed size and colour.
 */
function style(family: string): TextStyle {
  return { fontFamily: family, fontSize: SIZE, color: BLACK, weight: 400, italic: false };
}

/**
 * Covers a string with one style run.
 *
 * @param text - The source text.
 * @param textStyle - Its style.
 * @returns The run list.
 */
function one(text: string, textStyle: TextStyle): StyleRun[] {
  return [{ length: text.length, style: textStyle }];
}

describe('layoutText with HarfBuzz shaping', () => {
  it('makes the EB Garamond ffi in office one glyph covering all three characters', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const layout = layoutText(
      'office',
      one('office', style('EB Garamond')),
      null,
      createShapingMeasurer(shaper, [font]),
    );
    expect(layout.glyphs.map(({ index, end }) => [index, end])).toEqual([
      [0, 1],
      [1, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(layout.glyphs[1]).toMatchObject({ codepoint: 'f'.codePointAt(0), run: 0 });
    expect(layout.glyphs.every((glyph) => glyph.glyphId !== null)).toBe(true);
  });

  it('uses shaped GPOS kerning for DM Sans AV and resolves faces like the metrics measurer', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('dm-sans');
    const shaping = createShapingMeasurer(shaper, [font]);
    const metrics = createMetricsMeasurer([font.metrics]);
    const textStyle = style('DM Sans');
    expect(shaping.faceIdOf(textStyle)).toBe(metrics.faceIdOf(textStyle));
    const requests: TextStyle[] = [
      { ...textStyle, fontFamily: 'unknown' },
      { ...textStyle, weight: 700 },
      { ...textStyle, italic: true },
    ];
    for (const requested of requests) {
      expect(shaping.faceIdOf(requested)).toBe(metrics.faceIdOf(requested));
    }
    const shaped = shapeText(
      shaper,
      shaper.face(shaping.faceIdOf(textStyle), font.bytes),
      'AV',
      0,
      2,
    );
    const layout = layoutText('AV', one('AV', textStyle), null, shaping);
    const expectedWidth = shaped.glyphs.reduce((sum, glyph) => sum + glyph.advance * SIZE, 0);
    expect(layout.width).toBeCloseTo(expectedWidth, 10);
    expect(layout.glyphs.map((glyph) => glyph.advance)).toEqual(
      shaped.glyphs.map((glyph) => glyph.advance * SIZE),
    );
    expect(layout.width).not.toBe(layoutText('AV', one('AV', textStyle), null, metrics).width);
  });

  it('adds letter spacing once per cluster and trims it after the last cluster', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const measurer = createShapingMeasurer(shaper, [font]);
    const plain = layoutText('office', one('office', style('EB Garamond')), null, measurer);
    const trackedStyle = {
      ...style('EB Garamond'),
      letterSpacing: { value: 2, unit: 'px' as const },
    };
    const tracked = layoutText('office', one('office', trackedStyle), null, measurer);
    expect(tracked.glyphs).toHaveLength(4);
    expect(tracked.width - plain.width).toBeCloseTo(6, 10);
    expect((tracked.glyphs[2]?.x ?? 0) - (plain.glyphs[2]?.x ?? 0)).toBeCloseTo(4, 10);
  });

  it('shapes across colour boundaries but splits at a font-size boundary', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const measurer = createShapingMeasurer(shaper, [font]);
    const normal = style('EB Garamond');
    const coloured = layoutText(
      'office',
      [
        { length: 2, style: normal },
        { length: 4, style: { ...normal, color: RED } },
      ],
      null,
      measurer,
    );
    expect(coloured.glyphs.map(({ index, end }) => [index, end])).toContainEqual([1, 4]);
    expect(coloured.glyphs.find((glyph) => glyph.index === 1)?.run).toBe(0);
    const resized = layoutText(
      'office',
      [
        { length: 2, style: normal },
        { length: 4, style: { ...normal, fontSize: SIZE * 2 } },
      ],
      null,
      measurer,
    );
    expect(resized.glyphs.some((glyph) => glyph.index === 1 && glyph.end === 4)).toBe(false);
    expect(resized.glyphs.some((glyph) => glyph.end === 2)).toBe(true);
  });

  it('keeps DM Sans kerning across a colour boundary', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('dm-sans');
    const normal = style('DM Sans');
    const measurer = createShapingMeasurer(shaper, [font]);
    const plain = layoutText('AV', one('AV', normal), null, measurer);
    const coloured = layoutText(
      'AV',
      [
        { length: 1, style: normal },
        { length: 1, style: { ...normal, color: RED } },
      ],
      null,
      measurer,
    );
    expect(coloured.width).toBe(plain.width);
    expect(coloured.glyphs.map((glyph) => glyph.run)).toEqual([0, 1]);
  });

  it('wraps after a space and reshapes each resulting line', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const measurer = createShapingMeasurer(shaper, [font]);
    const textStyle = style('EB Garamond');
    const first = layoutText('office ', one('office ', textStyle), null, measurer);
    const layout = layoutText(
      'office affine',
      one('office affine', textStyle),
      first.width + 1,
      measurer,
    );
    expect(layout.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 7],
      [7, 13],
    ]);
    const firstLine = layout.glyphs.filter((glyph) => glyph.line === 0);
    expect(firstLine.map((glyph) => glyph.glyphId)).toEqual(
      first.glyphs.map((glyph) => glyph.glyphId),
    );
    const second = layoutText('affine', one('affine', textStyle), null, measurer);
    expect(layout.glyphs.filter((glyph) => glyph.line === 1).map((glyph) => glyph.glyphId)).toEqual(
      second.glyphs.map((glyph) => glyph.glyphId),
    );
  });

  it('breaks long words only at cluster boundaries', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const text = 'office';
    const layout = layoutText(
      text,
      one(text, style('EB Garamond')),
      1,
      createShapingMeasurer(shaper, [font]),
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.glyphs.some((glyph) => glyph.index === 1 && glyph.end === 4)).toBe(true);
    expect(layout.lines.every((line) => line.end !== 2 && line.end !== 3)).toBe(true);
  });

  it('places Arabic in visual buffer order with complete character coverage', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('noto-sans-arabic');
    const text = 'مرحبا بالعالم';
    const layout = layoutText(
      text,
      one(text, style('Noto Sans Arabic')),
      null,
      createShapingMeasurer(shaper, [font]),
    );
    expect(layout.glyphs.map((glyph) => glyph.index)).toEqual(
      [...layout.glyphs.map((glyph) => glyph.index)].sort((a, b) => b - a),
    );
    // The pen advances along the buffer: glyphs with an advance are in increasing x. A mark has
    // no advance and HarfBuzz may place it left of its pen with a negative xOffset.
    const advancing = layout.glyphs.filter((glyph) => glyph.advance > 0).map((glyph) => glyph.x);
    expect(advancing).toEqual([...advancing].sort((a, b) => a - b));
    const ranges = [
      ...new Map(layout.glyphs.map(({ index, end }) => [index, [index, end] as const])).values(),
    ].sort((a, b) => a[0] - b[0]);
    expect(ranges[0]?.[0]).toBe(0);
    expect(ranges.at(-1)?.[1]).toBe(text.length);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]?.[0]).toBe(ranges[index - 1]?.[1]);
    }
  });

  it('maps Devanagari conjunct clusters back to UTF-16 ranges', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('noto-sans-devanagari');
    const text = 'नमस्ते दुनिया';
    const layout = layoutText(
      text,
      one(text, style('Noto Sans Devanagari')),
      null,
      createShapingMeasurer(shaper, [font]),
    );
    expect(layout.glyphs.some((glyph) => glyph.index === 2 && glyph.end === 4)).toBe(true);
    expect(layout.glyphs.some((glyph) => glyph.index === 4 && glyph.end === 6)).toBe(true);
    expect(layout.glyphs.every((glyph) => glyph.index >= 0 && glyph.end <= text.length)).toBe(true);
  });

  it('places each shaped glyph with HarfBuzz offsets and the metrics baseline', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('noto-sans-devanagari');
    const text = 'नमस्ते दुनिया';
    const textStyle = style('Noto Sans Devanagari');
    const face = shaper.face('position-devanagari', font.bytes);
    const shaped = shapeText(shaper, face, text, 0, text.length);
    const layout = layoutText(
      text,
      one(text, textStyle),
      null,
      createShapingMeasurer(shaper, [font]),
    );
    expect(layout.glyphs).toHaveLength(shaped.glyphs.length);
    expect(layout.lines[0]?.baseline).toBeCloseTo(
      (font.metrics.ascent + (1.25 - font.metrics.ascent - font.metrics.descent) / 2) * SIZE,
      10,
    );
    let pen = 0;
    for (const [index, glyph] of shaped.glyphs.entries()) {
      const positioned = layout.glyphs[index];
      expect(positioned?.glyphId).toBe(glyph.glyphId);
      expect(positioned?.index).toBe(glyph.cluster);
      expect(positioned?.codepoint).toBe(text.codePointAt(glyph.cluster));
      expect(positioned?.x).toBeCloseTo(pen + glyph.xOffset * SIZE, 10);
      expect(positioned?.y).toBeCloseTo(
        (layout.lines[0]?.baseline ?? 0) - glyph.yOffset * SIZE,
        10,
      );
      expect(positioned?.advance).toBeCloseTo(glyph.advance * SIZE, 10);
      pen += glyph.advance * SIZE;
    }
    expect(layout.width).toBeCloseTo(pen, 10);
  });

  it('returns identical output on repeated layouts', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('dm-sans');
    const measurer = createShapingMeasurer(shaper, [font]);
    const runs = one('AV To fi fl Wave', style('DM Sans'));
    expect(layoutText('AV To fi fl Wave', runs, 70, measurer)).toEqual(
      layoutText('AV To fi fl Wave', runs, 70, measurer),
    );
  });
});
