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
  color: 'ink',
  weight: 400,
  italic: false,
};
const runs = (weight: number): StyleRun[] => [
  { length: 2, style: { ...style, fontVariations: { wght: weight } } },
];

describe('measuring text at variable coordinates', () => {
  it('uses the TextShaping face for the run family and returns reference width at 700', async () => {
    const shaping = createTextShaping(await loadShaper(), {
      bytesOf: (face) => (face.family === family ? bytes : undefined),
    });
    const measurer = shaping.measurerFor([metrics]);
    const regular = measureText('Aa', runs(400), null, [metrics], measurer);
    const bold = measureText('Aa', runs(700), null, [metrics], measurer);
    const instance = reference.at['700'];
    if (instance === undefined) throw new Error('Missing 700 reference');
    const aUpper = instance.glyphs.A;
    const aLower = instance.glyphs.a;
    if (aUpper === undefined || aLower === undefined) throw new Error('Missing reference glyphs');
    expect(bold.width).toBeCloseTo(
      ((aUpper.advance + aLower.advance) * fontSize) / instance.unitsPerEm,
      9,
    );
    expect(bold.width).toBeGreaterThan(regular.width);
    expect(bold.lineCount).toBe(1);
  });
});
