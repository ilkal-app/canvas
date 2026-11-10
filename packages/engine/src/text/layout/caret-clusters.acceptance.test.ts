/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  createFontMetrics,
  createMetricsMeasurer,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
} from '@canvas/text';
import type { LayoutGlyph, ShapingFont, TextLayout } from '@canvas/text';

import {
  caretRect as referenceCaretRect,
  indexAtLine as referenceIndexAtLine,
} from './__fixtures__/caret-reference.js';
import { caretRect, hitTest, indexAtLine } from './caret.js';

const FONT_FILES = {
  garamond: ['../../../../app/assets/fonts/library/ebgaramond/400.ttf', 'EB Garamond'],
  dmSans: ['../../../../app/assets/fonts/library/dmsans/400.ttf', 'DM Sans'],
  devanagari: [
    '../../../../app/assets/fonts/script-coverage/notosansdevanagari/400.ttf',
    'Noto Sans Devanagari',
  ],
  liberation: ['../../../assets/fonts/LiberationSans-Regular.ttf', 'Liberation Sans'],
  arabic: [
    '../../../../app/assets/fonts/script-coverage/notosansarabic/400.ttf',
    'Noto Sans Arabic',
  ],
} as const;

/**
 * Reads a checked-in face and derives the metrics used by both layout paths.
 *
 * @param name - The checked-in font to load.
 * @returns The face's file bytes and parsed metrics.
 */
function acceptanceFont(name: keyof typeof FONT_FILES): ShapingFont {
  const [path, family] = FONT_FILES[name];
  const bytes = readFileSync(new URL(path, import.meta.url));
  return {
    bytes,
    metrics: createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes)),
  };
}

/**
 * Lays a single style run out through the real shaper.
 *
 * @param text - The text to lay out.
 * @param font - The font's bytes and metrics.
 * @returns A shaped text layout at 24 world units.
 */
async function shapedLayout(text: string, font: ShapingFont): Promise<TextLayout> {
  const style: TextStyle = {
    fontFamily: font.metrics.face.family,
    fontSize: 24,
    weight: 400,
    italic: false,
    color: [0, 0, 0, 1],
  };
  return layoutText(
    text,
    [{ length: text.length, style }],
    null,
    createShapingMeasurer(await loadShaper(), [font]),
  );
}

/**
 * Returns all glyphs of one index range on a line, in layout order.
 *
 * @param layout - The shaped layout.
 * @param start - The cluster's first UTF-16 index.
 * @param end - One past its last UTF-16 index.
 * @returns The glyphs belonging to the cluster.
 */
function clusterGlyphs(layout: TextLayout, start: number, end: number): LayoutGlyph[] {
  return layout.glyphs.filter(
    (glyph) => glyph.line === 0 && glyph.index === start && glyph.end === end,
  );
}

/**
 * Makes an expected fixture element available to typed assertions.
 *
 * @param value - The element to require.
 * @returns The element when present.
 * @throws {Error} When the fixture does not contain it.
 */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture element is missing.');
  return value;
}

describe('cluster caret and hit-test acceptance', () => {
  it('places every EB Garamond office ligature caret in three equal parts', async () => {
    const layout = await shapedLayout('office', acceptanceFont('garamond'));
    const ligature = clusterGlyphs(layout, 1, 4);
    expect(ligature).toHaveLength(1);
    const left = required(ligature[0]).x;
    const width = required(ligature[0]).advance;
    const next = layout.glyphs.find((glyph) => glyph.index === 4);
    expect(next).toBeDefined();

    expect(caretRect(layout, 1).x).toBeCloseTo(left, 8);
    expect(caretRect(layout, 2).x).toBeCloseTo(left + width / 3, 8);
    expect(caretRect(layout, 3).x).toBeCloseTo(left + (2 * width) / 3, 8);
    expect(caretRect(layout, 4).x).toBeCloseTo(required(next).x, 8);
    expect(caretRect(layout, 2).x).toBeLessThan(caretRect(layout, 3).x);

    const y = required(layout.lines[0]).y + 1;
    const epsilon = width / 1000;
    expect(hitTest(layout, { x: left + width / 6 - epsilon, y })).toBe(1);
    expect(hitTest(layout, { x: left + width / 6 + epsilon, y })).toBe(2);
    expect(hitTest(layout, { x: left + width / 2 - epsilon, y })).toBe(2);
    expect(hitTest(layout, { x: left + width / 2 + epsilon, y })).toBe(3);
  });

  it('splits a DM Sans fi ligature into two grapheme parts', async () => {
    const layout = await shapedLayout('fi', acceptanceFont('dmSans'));
    const ligature = clusterGlyphs(layout, 0, 2);
    expect(ligature).toHaveLength(1);
    const left = required(ligature[0]).x;
    const width = required(ligature[0]).advance;
    expect(caretRect(layout, 0).x).toBeCloseTo(left, 8);
    expect(caretRect(layout, 1).x).toBeCloseTo(left + width / 2, 8);
    expect(caretRect(layout, 2).x).toBeCloseTo(
      required(layout.lines[0]).x + required(layout.lines[0]).width,
      8,
    );
    const y = required(layout.lines[0]).y + 1;
    expect(hitTest(layout, { x: left + width / 4 - width / 1000, y })).toBe(0);
    expect(hitTest(layout, { x: left + width / 4 + width / 1000, y })).toBe(1);
  });

  it('uses one box per Devanagari cluster and only grapheme hit indices', async () => {
    const text = 'नमस्ते';
    const layout = await shapedLayout(text, acceptanceFont('devanagari'));
    const firstOfMulti = layout.glyphs.find(
      (glyph) => clusterGlyphs(layout, glyph.index, glyph.end).length > 1,
    );
    expect(firstOfMulti).toBeDefined();
    const glyphs = clusterGlyphs(layout, required(firstOfMulti).index, required(firstOfMulti).end);
    const left = required(glyphs[0]).x;
    expect(caretRect(layout, required(firstOfMulti).index).x).toBeCloseTo(left, 8);

    const boundaries = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ].map((part) => part.index);
    boundaries.push(text.length);
    // HarfBuzz may split a conjunct the grapheme rules keep whole ("स्ते" is [2,4) + [4,6) but one
    // grapheme [2,6)), so the box is the grapheme's: its clusters' glyphs together, mid-point rule.
    const unitStart = Math.max(...boundaries.filter((at) => at <= required(firstOfMulti).index));
    const unitEnd = Math.min(...boundaries.filter((at) => at >= required(firstOfMulti).end));
    const unit = layout.glyphs.filter(
      (glyph) => glyph.line === 0 && glyph.index >= unitStart && glyph.end <= unitEnd,
    );
    expect(unit.length).toBeGreaterThan(glyphs.length);
    const unitLeft = Math.min(...unit.map((glyph) => glyph.x));
    const unitWidth = unit.reduce((sum, glyph) => sum + glyph.advance, 0);
    expect(indexAtLine(layout, 0, unitLeft + unitWidth / 2 - unitWidth / 1000)).toBe(unitStart);
    expect(indexAtLine(layout, 0, unitLeft + unitWidth / 2 + unitWidth / 1000)).toBe(unitEnd);
    for (let index = 0; index <= text.length; index += 1) {
      expect(Number.isFinite(caretRect(layout, index).x)).toBe(true);
    }
    const positions = boundaries.map((index) => caretRect(layout, index).x);
    for (let position = 1; position < positions.length; position += 1) {
      expect(required(positions[position])).toBeGreaterThanOrEqual(
        required(positions[position - 1]),
      );
    }
    for (let x = -2; x <= layout.width + 2; x += 0.5) {
      expect(boundaries).toContain(hitTest(layout, { x, y: required(layout.lines[0]).y + 1 }));
    }
  });

  it('keeps a combining mark inside its grapheme in Liberation Sans', async () => {
    const layout = await shapedLayout('e\u0301x', acceptanceFont('liberation'));
    expect(caretRect(layout, 1).x).toBe(caretRect(layout, 0).x);
    for (let x = -2; x <= layout.width + 2; x += 0.5) {
      expect(hitTest(layout, { x, y: required(layout.lines[0]).y + 1 })).not.toBe(1);
    }
  });

  it('maps Arabic indices to finite carets and keeps hit indices in range', async () => {
    const text = 'مرحبا بالعالم';
    const layout = await shapedLayout(text, acceptanceFont('arabic'));
    for (let index = 0; index <= text.length; index += 1) {
      expect(Number.isFinite(caretRect(layout, index).x)).toBe(true);
    }
    for (let x = -2; x <= layout.width + 2; x += 0.5) {
      const index = hitTest(layout, { x, y: required(layout.lines[0]).y + 1 });
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(text.length);
    }
  });
});

describe('per-codepoint caret identity', () => {
  it.each([
    { text: 'office', maxWidth: null, align: 'left' },
    { text: 'a\nb', maxWidth: null, align: 'center' },
    { text: 'aaa bbb', maxWidth: 42, align: 'right' },
  ] as const)(
    'preserves every caret and a grid of hit indices for $text',
    ({ text, maxWidth, align }) => {
      const font = acceptanceFont('liberation');
      const style: TextStyle = {
        fontFamily: font.metrics.face.family,
        fontSize: 12,
        weight: 400,
        italic: false,
        color: [0, 0, 0, 1],
      };
      const runs: StyleRun[] = [{ length: text.length, style }];
      const layout = layoutText(text, runs, maxWidth, createMetricsMeasurer([font.metrics]), align);
      for (let index = 0; index <= text.length; index += 1) {
        expect(caretRect(layout, index)).toEqual(referenceCaretRect(layout, index));
      }
      for (const [lineIndex, line] of layout.lines.entries()) {
        for (let x = line.x - 3; x <= line.x + line.width + 3; x += 0.5) {
          expect(indexAtLine(layout, lineIndex, x)).toBe(
            referenceIndexAtLine(layout, lineIndex, x),
          );
        }
      }
    },
  );
});
