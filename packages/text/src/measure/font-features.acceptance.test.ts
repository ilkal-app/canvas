/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { loadShaper } from '../shaping/shaper.js';

import { measureText } from './measure-text.js';
import { createTextShaping } from './text-shaping.js';

const path = new URL('../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url);
const bytes = new Uint8Array(readFileSync(path));
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
 * Makes a single style run for a measured string.
 *
 * @param text - The text.
 * @param features - OpenType settings.
 * @returns One run.
 */
function runs(text: string, features?: Readonly<Record<string, number>>): StyleRun[] {
  return [
    {
      length: text.length,
      style:
        features === undefined
          ? style
          : {
              ...style,
              fontFeatures: features,
            },
    },
  ];
}

describe('MCP OpenType feature measurement', () => {
  it('measures office wider with ligatures disabled through bundled-face shaping', async () => {
    const shaping = createTextShaping(await loadShaper(), {
      bytesOf: (face) => (face.family === 'EB Garamond' ? bytes : undefined),
    });
    const measurer = shaping.measurerFor([metrics]);
    const normal = measureText('office', runs('office'), null, [metrics], measurer);
    const unligated = measureText('office', runs('office', { liga: 0 }), null, [metrics], measurer);
    expect(unligated.width).not.toBe(normal.width);
  });

  it('keeps features for a file-backed face beside a face measured from a table alone', async () => {
    // A metrics-only face (MCP's CJK coverage) wraps the whole measurer.
    const table = createFontMetrics(
      { family: 'Table Only', weight: 400, isItalic: false },
      parseFont(bytes),
    );
    const shaping = createTextShaping(
      await loadShaper(),
      { bytesOf: (face) => (face.family === 'EB Garamond' ? bytes : undefined) },
      {
        coverage: {
          bytesOf: () => undefined,
          metricsOf: (face) => (face.family === 'Table Only' ? table : undefined),
        },
      },
    );
    const fonts = [metrics, table];
    const measurer = shaping.measurerFor(fonts);
    const normal = measureText('office', runs('office'), null, fonts, measurer);
    const unligated = measureText('office', runs('office', { liga: 0 }), null, fonts, measurer);
    expect(unligated.width).not.toBe(normal.width);
  });
});
