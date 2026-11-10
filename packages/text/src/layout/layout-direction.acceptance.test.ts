/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const FONT_FILES = {
  latin: '../../../app/assets/fonts/library/dmsans/400.ttf',
  hebrew: '../../../app/assets/fonts/script-coverage/notosanshebrew/400.ttf',
} as const;

/**
 * Loads a real checked-in font for direction-sensitive shaping.
 *
 * @param script - The font script.
 * @returns The font bytes and metrics.
 */
function font(script: keyof typeof FONT_FILES) {
  const family = script === 'latin' ? 'DM Sans' : 'Noto Sans Hebrew';
  const bytes = readFileSync(new URL(FONT_FILES[script], import.meta.url));
  return {
    bytes,
    metrics: createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes)),
  };
}

/**
 * Covers one paragraph with its script's real font.
 *
 * @param text - The paragraph.
 * @param script - The font script.
 * @returns Its style run.
 */
function run(text: string, script: keyof typeof FONT_FILES): StyleRun {
  const style: TextStyle = {
    fontFamily: script === 'latin' ? 'DM Sans' : 'Noto Sans Hebrew',
    fontSize: 20,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  return { length: text.length, style };
}

describe('paragraph direction and logical alignment', () => {
  it('resolves start independently for auto Hebrew and English paragraphs', async () => {
    const text = 'שלום\nHello';
    const layout = layoutText(
      text,
      [run('שלום\n', 'hebrew'), run('Hello', 'latin')],
      200,
      createShapingMeasurer(await loadShaper(), [font('latin'), font('hebrew')]),
      'start',
      'auto',
    );
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]?.x).toBeGreaterThan(0);
    expect(layout.lines[1]?.x).toBe(0);
  });

  it('forces Hebrew into an ltr paragraph, including end alignment', async () => {
    const text = 'שלום';
    const measurer = createShapingMeasurer(await loadShaper(), [font('latin'), font('hebrew')]);
    const automatic = layoutText(text, [run(text, 'hebrew')], 200, measurer, 'start', 'auto');
    const forced = layoutText(text, [run(text, 'hebrew')], 200, measurer, 'start', 'ltr');
    expect(automatic.lines[0]?.x).toBeGreaterThan(0);
    expect(forced.lines[0]?.x).toBe(0);
    expect(forced.glyphs.every(({ level }) => level % 2 === 1)).toBe(true);
    expect(
      layoutText(text, [run(text, 'hebrew')], 200, measurer, 'end', 'ltr').lines[0]?.x,
    ).toBeGreaterThan(0);
  });

  it('bidi processes Latin in an explicit rtl paragraph and hangs soft-line spaces on the left', async () => {
    const text = 'Hello world again';
    const measurer = createShapingMeasurer(await loadShaper(), [font('latin'), font('hebrew')]);
    const layout = layoutText(text, [run(text, 'latin')], 90, measurer, 'start', 'rtl');
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(
      layout.glyphs.filter(({ codepoint }) => codepoint !== 32).every(({ level }) => level === 2),
    ).toBe(true);
    expect(layout.lines[0]?.x).toBeGreaterThan(0);
    const first = layout.glyphs.filter(({ line }) => line === 0);
    const trailingSpace = first.find(({ codepoint }) => codepoint === 32);
    expect(trailingSpace).toBeDefined();
    expect(trailingSpace?.x).toBeLessThan(
      Math.min(...first.filter(({ codepoint }) => codepoint !== 32).map(({ x }) => x)),
    );
    expect(layoutText(text, [run(text, 'latin')], 90, measurer, 'end', 'rtl').lines[0]?.x).toBe(0);
  });

  it('uses explicit direction for start/end on the metrics path', () => {
    const text = 'Latin only';
    const measurer = createMetricsMeasurer([font('latin').metrics]);
    const runs = [run(text, 'latin')];
    expect(layoutText(text, runs, 200, measurer, 'start', 'ltr').lines[0]?.x).toBe(0);
    expect(layoutText(text, runs, 200, measurer, 'end', 'ltr').lines[0]?.x).toBeGreaterThan(0);
    expect(layoutText(text, runs, 200, measurer, 'start', 'rtl').lines[0]?.x).toBeGreaterThan(0);
    expect(layoutText(text, runs, 200, measurer, 'end', 'rtl').lines[0]?.x).toBe(0);
  });
});
