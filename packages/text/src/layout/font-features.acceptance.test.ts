/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { layoutText } from './layout-text.js';

const bytes = new Uint8Array(
  readFileSync(new URL('../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url)),
);
const metrics = createFontMetrics(
  { family: 'EB Garamond', weight: 400, isItalic: false },
  parseFont(bytes),
);
const style: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * Makes a run with an optional feature map.
 *
 * @param length - Run length.
 * @param fontFeatures - OpenType settings.
 * @returns A style run.
 */
function run(length: number, fontFeatures?: Readonly<Record<string, number>>): StyleRun {
  return { length, style: fontFeatures === undefined ? style : { ...style, fontFeatures } };
}

describe('OpenType features in text layout', () => {
  it('cuts adjacent shaping segments when only feature settings differ', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    if (measurer.shape === undefined) throw new Error('Expected shaping measurer');
    const shape = vi.fn(measurer.shape);
    const layout = layoutText('officeoffice', [run(6), run(6, { liga: 0 })], null, {
      ...measurer,
      shape,
    });
    expect(shape.mock.calls.map(([, , start, end]) => [start, end])).toEqual([
      [0, 6],
      [6, 12],
    ]);
    expect(layout.glyphs.filter(({ run: index }) => index === 0).length).toBeLessThan(6);
    expect(layout.glyphs.filter(({ run: index }) => index === 1)).toHaveLength(6);
    expect(layout.runs[1]).toMatchObject({ fontFeatures: { liga: 0 } });
  });

  it('does not merge or reuse shapes for feature styles with equal face and size', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [{ metrics, bytes }]);
    if (measurer.shape === undefined) throw new Error('Expected shaping measurer');
    const shape = vi.fn(measurer.shape);
    layoutText('fifi', [run(2, { liga: 0 }), run(2, { liga: 1 })], null, {
      ...measurer,
      shape,
    });
    expect(shape.mock.calls.map(([, , start, end]) => [start, end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect((shape.mock.calls[0] as unknown[] | undefined)?.[7]).toEqual({ liga: 0 });
    expect((shape.mock.calls[1] as unknown[] | undefined)?.[7]).toEqual({ liga: 1 });
  });
});
