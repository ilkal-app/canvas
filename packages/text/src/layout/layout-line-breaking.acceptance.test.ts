/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';
import { lineBreakOpportunities } from '../line-break/line-breaks.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { createMetricsMeasurer, type GlyphMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const FONT_FILES = {
  'Noto Sans SC': '../../../app/assets/fonts/script-coverage/notosanssc/400.ttf',
  'Noto Sans Thai': '../../../app/assets/fonts/script-coverage/notosansthai/400.ttf',
  'DM Sans': '../../../app/assets/fonts/library/dmsans/400.ttf',
} as const;

type Family = keyof typeof FONT_FILES;

/**
 * Loads real checked-in bytes and their bundled-face metrics.
 *
 * @param family - Font family.
 * @returns Font bytes and metrics.
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
 * A single style run covering the entire input.
 *
 * @param text - Source text.
 * @param family - Font family.
 * @returns One style run.
 */
function runs(text: string, family: Family): StyleRun[] {
  const style: TextStyle = {
    fontFamily: family,
    fontSize: 20,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  return [{ length: text.length, style }];
}

/**
 * Both independent production layout paths for one checked-in face.
 *
 * @param family - Font family.
 * @returns Metrics and shaping measurers.
 */
async function measurers(family: Family): Promise<readonly GlyphMeasurer[]> {
  const face = font(family);
  return [createMetricsMeasurer([face.metrics]), createShapingMeasurer(await loadShaper(), [face])];
}

describe('layoutText Unicode line breaking with both measurers', () => {
  it('wraps CJK without spaces only at legal boundaries and keeps closers attached', async () => {
    const text = '漢字かな「カナ」。漢字かな」カナ';
    const legal = new Set(lineBreakOpportunities(text).map(({ index }) => index));
    for (const measurer of await measurers('Noto Sans SC')) {
      const maxWidth = layoutText(
        '漢字かな',
        runs('漢字かな', 'Noto Sans SC'),
        null,
        measurer,
      ).width;
      const layout = layoutText(text, runs(text, 'Noto Sans SC'), maxWidth, measurer);
      expect(layout.lines.length).toBeGreaterThan(2);
      for (const [index, line] of layout.lines.entries()) {
        if (index === 0) continue;
        expect(legal.has(line.start), `line ${String(index)} starts at ${String(line.start)}`).toBe(
          true,
        );
        expect(['。', '」']).not.toContain(text[line.start]);
      }
      for (const line of layout.lines.slice(0, -1))
        expect(line.width).toBeLessThanOrEqual(maxWidth + 0.001);
    }
  });

  it('treats CR LF as one hard break and U+2028/U+2029 like LF', async () => {
    for (const measurer of await measurers('DM Sans')) {
      for (const separator of ['\n', '\r\n', '\u2028', '\u2029']) {
        const text = `a${separator}b`;
        const layout = layoutText(text, runs(text, 'DM Sans'), null, measurer);
        expect(layout.lines.map(({ start, end, isHard }) => [start, end, isHard])).toEqual([
          [0, 1, true],
          [1 + separator.length, text.length, true],
        ]);
      }
    }
  });

  it('moves a nonbreaking a-NBSP-b unit together at an earlier space', async () => {
    const text = 'go a\u00a0b';
    for (const measurer of await measurers('DM Sans')) {
      const maxWidth = layoutText('go ', runs('go ', 'DM Sans'), null, measurer).width + 1;
      const layout = layoutText(text, runs(text, 'DM Sans'), maxWidth, measurer);
      expect(layout.lines.map(({ start }) => start)).toEqual([0, 3]);
    }
  });

  it('wraps Thai at Intl word boundaries', async () => {
    const text = 'ภาษาไทยง่ายนิดเดียว';
    const boundaries = new Set(
      [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map(
        ({ index }) => index,
      ),
    );
    for (const measurer of await measurers('Noto Sans Thai')) {
      const maxWidth = layoutText(
        'ภาษาไทย',
        runs('ภาษาไทย', 'Noto Sans Thai'),
        null,
        measurer,
      ).width;
      const layout = layoutText(text, runs(text, 'Noto Sans Thai'), maxWidth, measurer);
      expect(layout.lines.length).toBeGreaterThan(1);
      for (const line of layout.lines) expect(boundaries.has(line.start)).toBe(true);
    }
  });

  it('preserves hanging spaces and the previous ASCII prose wrap positions', async () => {
    for (const measurer of await measurers('DM Sans')) {
      for (const text of ['one two six', 'red fox ran', 'new day now']) {
        const maxWidth =
          layoutText(text.slice(0, 4), runs(text.slice(0, 4), 'DM Sans'), null, measurer).width + 1;
        const layout = layoutText(text, runs(text, 'DM Sans'), maxWidth, measurer);
        expect(layout.lines.map(({ start }) => start)).toEqual([0, 4, 8]);
      }
      const text = 'one two six';
      const maxWidth = layoutText('one ', runs('one ', 'DM Sans'), null, measurer).width + 1;
      const layout = layoutText(text, runs(text, 'DM Sans'), maxWidth, measurer);
      expect(layout.lines[0]?.end).toBe(4);
      expect(layout.glyphs.some(({ line, codepoint }) => line === 0 && codepoint === 0x20)).toBe(
        true,
      );
      const visible = layout.glyphs.filter(
        ({ line, codepoint }) => line === 0 && codepoint !== 0x20,
      );
      expect(Math.max(...visible.map(({ x, advance }) => x + advance))).toBeLessThan(maxWidth);
    }
  });

  it('still emergency cuts a word too long for the width, at a grapheme boundary', async () => {
    const text = 'accommodation';
    const graphemes = new Set(
      [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(
        ({ index }) => index,
      ),
    );
    for (const measurer of await measurers('DM Sans')) {
      const width = layoutText('acc', runs('acc', 'DM Sans'), null, measurer).width;
      const layout = layoutText(text, runs(text, 'DM Sans'), width, measurer);
      expect(layout.lines.length).toBeGreaterThan(1);
      for (const line of layout.lines) expect(graphemes.has(line.start)).toBe(true);
    }
  });

  it('chooses the same starts in metrics and shaping for fixed-width CJK glyphs', async () => {
    const text = '漢字漢字漢字漢字';
    const [metrics, shaping] = await measurers('Noto Sans SC');
    if (metrics === undefined || shaping === undefined) throw new Error('Missing measurer');
    const width = layoutText('漢字漢', runs('漢字漢', 'Noto Sans SC'), null, metrics).width;
    const starts = (measurer: GlyphMeasurer): number[] =>
      layoutText(text, runs(text, 'Noto Sans SC'), width, measurer).lines.map(({ start }) => start);
    expect(starts(shaping)).toEqual(starts(metrics));
  });
});
