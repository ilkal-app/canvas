/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { layoutText } from './layout-text.js';

const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: 'ink',
  weight: 400,
  italic: false,
};
const run = (text: string): StyleRun[] => [{ length: text.length, style: STYLE }];

describe('list layout', () => {
  it('keeps plain lines and glyphs identical and rejects mismatched paragraph counts', () => {
    const text = 'one\ntwo';
    const plain = layoutText(text, run(text), 100, new FakeGlyphMeasurer());
    const explicit = layoutText(text, run(text), 100, new FakeGlyphMeasurer(), 'left', 'auto', [
      {},
      {},
    ]);
    expect(explicit.lines).toEqual(plain.lines);
    expect(explicit.glyphs).toEqual(plain.glyphs);
    expect(explicit.markers ?? []).toEqual([]);
    expect(() =>
      layoutText(text, run(text), 100, new FakeGlyphMeasurer(), 'left', 'auto', [{}]),
    ).toThrow(RangeError);
  });

  it('indents all wrapped lines and positions the marker before the first line', () => {
    const text = 'one two three four';
    const layout = layoutText(text, run(text), 70, new FakeGlyphMeasurer(), 'left', 'ltr', [
      { list: 'bullet', level: 1 },
    ]);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.every((line) => line.x === 30 && line.width <= 40)).toBe(true);
    const markers = layout.markers ?? [];
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      text: '◦',
      line: 0,
      run: 0,
      baseline: layout.lines[0]?.baseline,
    });
    expect((markers[0]?.x ?? 0) + (markers[0]?.width ?? 0)).toBeCloseTo(25);
  });

  it('makes a marker for an empty paragraph and includes indent in auto width', () => {
    const text = 'a\n';
    const layout = layoutText(text, run(text), null, new FakeGlyphMeasurer(), 'left', 'ltr', [
      {},
      { list: 'numbered' },
    ]);
    const markers = layout.markers ?? [];
    expect(markers).toMatchObject([{ paragraph: 1, line: 1, text: '1.' }]);
    expect(layout.width).toBe(Math.max(...layout.lines.map((line) => line.x + line.width)));
  });

  it('indents an RTL start-aligned paragraph from the right', async () => {
    const bytes = readFileSync(
      new URL('../../../app/assets/fonts/script-coverage/notosanshebrew/400.ttf', import.meta.url),
    );
    const metrics = createFontMetrics(
      { family: 'Noto Sans Hebrew', weight: 400, isItalic: false },
      parseFont(bytes),
    );
    const measurer = createShapingMeasurer(await loadShaper(), [{ bytes, metrics }]);
    const text = 'שלום עולם';
    const runs = [
      { length: text.length, style: { ...STYLE, fontFamily: 'Noto Sans Hebrew', fontSize: 20 } },
    ];
    const layout = layoutText(text, runs, 200, measurer, 'start', 'rtl', [{ list: 'bullet' }]);
    const first = layout.lines[0];
    const marker = layout.markers?.[0];
    expect((first?.x ?? 0) + (first?.width ?? 0)).toBeCloseTo(170);
    expect(marker?.x).toBeCloseTo((first?.x ?? 0) + (first?.width ?? 0) + 10);
    expect(marker?.baseline).toBe(first?.baseline);
  });
});
