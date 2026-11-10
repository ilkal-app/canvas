// The lazy shaping measurer still answers the per-codepoint questions of the
// `GlyphMeasurer` contract from metrics alone, without reading a font file; layout shapes with
// it, so only other callers of the contract ask them.
import { describe, expect, it } from 'vitest';

import { fontFaceId } from '../font/font-face.js';
import { loadShaper } from '../shaping/shaper.js';

import { measuringFontsFor } from './measure-text.js';
import { createTextShaping } from './text-shaping.js';

describe('createTextShaping, reading files when shaped', () => {
  it('answers advances and kerning from metrics without reading a file', async () => {
    const style = {
      fontFamily: 'Liberation Sans',
      fontSize: 20,
      color: 'ink',
      weight: 400,
      italic: false,
    } as const;
    const { fonts } = measuringFontsFor([[{ length: 2, style }]]);
    const font = fonts.find(({ face }) => face.family === 'Liberation Sans');
    if (font === undefined) throw new Error('Liberation Sans has no metrics');
    let reads = 0;
    const shaping = createTextShaping(
      await loadShaper(),
      {
        bytesOf: () => {
          reads += 1;
          return undefined;
        },
      },
      { readFiles: 'when-shaped' },
    );
    const measurer = shaping.measurerFor(fonts);
    const faceId = fontFaceId(font.face);
    const metrics = new Map(font.advances);
    expect(measurer.advance(faceId, 0x41)).toBe(metrics.get(0x41));
    // A pair the face's metrics kern: the measurer gives exactly that adjustment.
    const pair = font.kerning.find(([, , adjustment]) => adjustment !== 0);
    if (pair === undefined) throw new Error('Liberation Sans kerns no pair');
    const [left, right, adjustment] = pair;
    expect(measurer.kerning(faceId, left, right)).toBe(adjustment);
    expect(reads).toBe(0);
  });
});
