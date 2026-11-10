/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { loadShaper } from '../shaping/shaper.js';

import { measureText } from './measure-text.js';
import { createTextShaping } from './text-shaping.js';

const corpus = new URL('../__fixtures__/format-corpus/', import.meta.url);
const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', corpus)));
const family = 'Corpus Sans Variable';
const fontSize = 20;
const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
const style: TextStyle = {
  fontFamily: family,
  fontSize,
  color: 'ink',
  weight: 400,
  italic: false,
};
const runs = (weight: number): StyleRun[] => [
  { length: 2, style: { ...style, fontVariations: { wght: weight } } },
];

describe('measuring at variable coordinates with files read when shaped', () => {
  it('normalises and shapes at coordinates like the eager measurer', async () => {
    const shaper = await loadShaper();
    const source = {
      bytesOf: (face: { family: string }) => (face.family === family ? bytes : undefined),
    };
    const lazy = createTextShaping(shaper, source, { readFiles: 'when-shaped' }).measurerFor([
      metrics,
    ]);
    const eager = createTextShaping(shaper, source).measurerFor([metrics]);
    const faceId = lazy.faceIdOf(style);
    expect(lazy.variationsOf?.(faceId, { wght: 999 })).toEqual({ wght: 700 });
    expect(measureText('Aa', runs(700), null, [metrics], lazy).width).toBe(
      measureText('Aa', runs(700), null, [metrics], eager).width,
    );
  });
});
