/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const corpus = new URL('../__fixtures__/format-corpus/', import.meta.url);
const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', corpus)));
const reference = JSON.parse(
  readFileSync(new URL('corpus-sans-variable.reference.json', corpus), 'utf8'),
) as {
  at: Readonly<Record<string, { unitsPerEm: number; glyphs: Record<string, { advance: number }> }>>;
};
const family = 'Corpus Sans Variable';
const fontSize = 20;
const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
const style: TextStyle = {
  fontFamily: family,
  fontSize,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const run = (length: number, fontVariations?: Record<string, number>): StyleRun => ({
  length,
  style: fontVariations === undefined ? style : { ...style, fontVariations },
});
const advance = (weight: number, char: string): number => {
  const instance = reference.at[String(weight)];
  if (instance === undefined) throw new Error(`Missing reference at ${String(weight)}`);
  const glyph = instance.glyphs[char];
  if (glyph === undefined) throw new Error(`Missing reference glyph ${char}`);
  return (glyph.advance * fontSize) / instance.unitsPerEm;
};

/**
 * Expects advances equal to the reference's, to float precision: shaped advances are font units
 * divided by the em, times the size, so they may differ in the last bit.
 *
 * @param actual - The advances laid out.
 * @param expected - The reference's.
 */
function expectAdvances(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) expect(actual?.[index]).toBeCloseTo(value, 9);
}

describe('variable coordinates in text layout', () => {
  it('normalises against each shaping face and shapes at those coordinates', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    const faceId = measurer.faceIdOf(style);
    expect(measurer.variationsOf?.(faceId, { wght: 700, wdth: 100 })).toEqual({ wght: 700 });
    expect(measurer.variationsOf?.(faceId, { wght: 400 })).toEqual({});
    expect(measurer.variationsOf?.(faceId, { wght: 999 })).toEqual({ wght: 700 });
    const shaped = measurer.shape?.(faceId, 'Aa', 0, 2, 'ltr', { wght: 700 });
    expectAdvances(
      shaped?.glyphs.map(({ advance: em }) => em),
      [advance(700, 'A') / fontSize, advance(700, 'a') / fontSize],
    );
  });

  it('ignores requested coordinates on a static face and on a metrics measurer', async () => {
    const staticFont = acceptanceFont('eb-garamond');
    const staticMeasurer = createShapingMeasurer(await loadShaper(), [staticFont]);
    expect(
      staticMeasurer.variationsOf?.(
        staticMeasurer.faceIdOf({ ...style, fontFamily: 'EB Garamond' }),
        { wght: 700 },
      ),
    ).toEqual({});
    expect(createMetricsMeasurer([metrics]).variationsOf).toBeUndefined();
  });

  it('uses 700 advances for both glyphs and makes the line wider than the default', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    const regular = layoutText('Aa', [run(2)], null, measurer);
    const bold = layoutText('Aa', [run(2, { wght: 700 })], null, measurer);
    expect(bold.runs[0]?.variations).toEqual({ wght: 700 });
    expectAdvances(
      bold.glyphs.map(({ advance: width }) => width),
      [advance(700, 'A'), advance(700, 'a')],
    );
    expect(bold.lines[0]?.width).toBeGreaterThan(regular.lines[0]?.width ?? 0);
    expect(regular.runs[0]?.variations).toBeUndefined();
  });

  it('uses run weight for an unset wght axis and lets an explicit coordinate win', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    const weighted = layoutText(
      'Aa',
      [{ length: 2, style: { ...style, weight: 700 } }],
      null,
      measurer,
    );
    expect(weighted.runs[0]?.variations).toEqual({ wght: 700 });
    expectAdvances(
      weighted.glyphs.map(({ advance: width }) => width),
      [advance(700, 'A'), advance(700, 'a')],
    );

    const explicit = layoutText(
      'A',
      [{ length: 1, style: { ...style, weight: 700, fontVariations: { wght: 550 } } }],
      null,
      measurer,
    );
    expect(explicit.runs[0]?.variations).toEqual({ wght: 550 });
    expect(explicit.glyphs[0]?.advance).toBeCloseTo(advance(550, 'A'), 9);
    expect(layoutText('A', [run(1)], null, measurer).runs[0]?.variations).toBeUndefined();
  });

  it('does not apply weight coordinates on static or metrics faces', async () => {
    const staticFont = acceptanceFont('eb-garamond');
    const staticMeasurer = createShapingMeasurer(await loadShaper(), [staticFont]);
    const staticStyle = { ...style, fontFamily: 'EB Garamond', weight: 700 as const };
    expect(
      layoutText('A', [{ length: 1, style: staticStyle }], null, staticMeasurer).runs[0]
        ?.variations,
    ).toBeUndefined();

    const metricsMeasurer = createMetricsMeasurer([metrics]);
    const weighted = layoutText(
      'A',
      [{ length: 1, style: { ...style, weight: 700 } }],
      null,
      metricsMeasurer,
    );
    const regular = layoutText('A', [run(1)], null, metricsMeasurer);
    expect(weighted.runs[0]?.variations).toBeUndefined();
    expect(weighted.glyphs.map(({ advance: width }) => width)).toEqual(
      regular.glyphs.map(({ advance: width }) => width),
    );
  });

  it('shapes adjacent coordinate styles separately and keeps each run coordinate', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    if (measurer.shape === undefined) throw new Error('Expected a shaping measurer');
    const shape = vi.fn(measurer.shape);
    const layout = layoutText('AA', [run(1, { wght: 400 }), run(1, { wght: 700 })], null, {
      ...measurer,
      shape,
    });
    expect(layout.runs.map(({ variations }) => variations)).toEqual([undefined, { wght: 700 }]);
    expect(layout.glyphs.map(({ run: index }) => index)).toEqual([0, 1]);
    expectAdvances(
      layout.glyphs.map(({ advance: width }) => width),
      [advance(400, 'A'), advance(700, 'A')],
    );
    expect(shape).toHaveBeenCalledTimes(2);
    expect(shape.mock.calls.map(([, , start, end]) => [start, end])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('treats clamped coordinates as the same style and honours the 550 instance', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    if (measurer.shape === undefined) throw new Error('Expected a shaping measurer');
    const shape = vi.fn(measurer.shape);
    const clamped = layoutText('AA', [run(1, { wght: 700 }), run(1, { wght: 750 })], null, {
      ...measurer,
      shape,
    });
    expect(clamped.runs.map(({ variations }) => variations)).toEqual([
      { wght: 700 },
      { wght: 700 },
    ]);
    expectAdvances(
      clamped.glyphs.map(({ advance: width }) => width),
      [advance(700, 'A'), advance(700, 'A')],
    );
    expect(shape).toHaveBeenCalledTimes(1);
    expect(shape.mock.calls[0]?.slice(2, 4)).toEqual([0, 2]);
    const bent = layoutText('A', [run(1, { wght: 550 })], null, measurer);
    expect(bent.runs[0]?.variations).toEqual({ wght: 550 });
    expect(bent.glyphs[0]?.advance).toBeCloseTo(advance(550, 'A'), 9);
  });

  it('ignores coordinates on the metrics path', () => {
    const measurer = createMetricsMeasurer([metrics]);
    const regular = layoutText('Aa', [run(2)], null, measurer);
    const requested = layoutText('Aa', [run(2, { wght: 700 })], null, measurer);
    expect(requested).toEqual(regular);
    expect(requested.runs[0]?.variations).toBeUndefined();
  });
});
