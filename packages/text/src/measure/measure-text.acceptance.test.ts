import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';

import { measureText } from './measure-text.js';

const regular = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const bold = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
);
const style: TextStyle = {
  fontFamily: 'Private Sans',
  fontSize: 24,
  color: 'ink',
  weight: 400,
  italic: false,
};
const name = 'PrivateSans-Condensed';
const plainFace = { family: 'Private Sans', weight: 400, isItalic: false } as const;
const namedFace = { ...plainFace, postScriptName: name };
const fonts = [
  createFontMetrics(plainFace, parseFont(regular)),
  createFontMetrics(namedFace, parseFont(bold)),
];

/**
 * Measures one run with the supplied face request.
 *
 * @param text - Words to measure.
 * @param runStyle - The requested face and text size.
 * @returns The measured width in world units.
 */
function widthOf(text: string, runStyle: TextStyle): number {
  const runs: StyleRun[] = [{ length: text.length, style: runStyle }];
  return measureText(text, runs, null, fonts).width;
}

describe('named face measurement', () => {
  it('uses the named file metrics when weight and slant equal the plain face', () => {
    const words = 'Wide private words';
    const plain = widthOf(words, style);
    const named = widthOf(words, { ...style, postScriptName: name });
    expect(named).toBeGreaterThan(plain);
    expect(named).toBe(widthOf(words, { ...style, postScriptName: name }));
  });
});
