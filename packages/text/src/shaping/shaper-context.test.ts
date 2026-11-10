// The shaper passes HarfBuzz only twelve UTF-16 units of context on each side of a
// stretch, since HarfBuzz keeps five characters. These cases shape a stretch with the whole
// paragraph as context, straight through harfbuzzjs, and check the shaper agrees: joining across
// the stretch's edges, surrogate pairs at the window's edge, and a newline inside the window.
import { describe, expect, it } from 'vitest';

import { acceptanceFont } from './__fixtures__/shaping-fonts.js';
import { loadShaper, shapeText } from './shaper.js';

/**
 * A stretch shaped right to left by harfbuzzjs with its whole paragraph as context.
 *
 * @param bytes - The font file.
 * @param text - The whole text.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past its last.
 * @returns Each glyph's id and cluster, clusters indexing the whole text.
 */
async function referenceShape(
  bytes: Uint8Array,
  text: string,
  start: number,
  end: number,
): Promise<[glyphId: number, cluster: number][]> {
  const hb = await import('harfbuzzjs');
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer)));
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const to = newline === -1 ? text.length : newline;
  const buffer = new hb.Buffer();
  buffer.addText(text.slice(from, to), start - from, end - start);
  buffer.setDirection(hb.Direction.RTL);
  buffer.guessSegmentProperties();
  buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
  hb.shape(font, buffer);
  return buffer.getGlyphInfos().map((info) => [info.codepoint, info.cluster + from]);
}

describe('the shaper’s context window', () => {
  it.each([
    // An Arabic stretch starting and ending mid-word: its first and last letters join outward.
    ['Arabic mid-word', 'سلام عليكم ورحمة الله وبركاته'.repeat(8), 61, 73],
    // Long runs of marks right at the window's edge.
    ['Arabic marks', `بِّّّّّّّّّّّّ${'ب'.repeat(4)}ٍٍٍٍٍٍٍٍٍٍٍٍٍٍٍ`, 14, 18],
    // Surrogate pairs filling the window before and after the stretch.
    ['surrogates', `${'𝐀'.repeat(12)}مرحبا${'𝐁'.repeat(12)}`, 24, 29],
    // A newline inside the window ends the context.
    ['newline', `بب\nسلام عليكم\nبب`, 3, 7],
  ] as const)('%s: the same glyphs as with the whole paragraph', async (name, text, start, end) => {
    const { bytes } = acceptanceFont('noto-sans-arabic');
    const shaper = await loadShaper();
    const face = shaper.face(`context:${name}`, bytes);
    const shaped = shapeText(shaper, face, text, start, end, 'rtl');
    const actual = shaped.glyphs.map(({ glyphId, cluster }) => [glyphId, cluster]);
    expect(actual).toEqual(await referenceShape(bytes, text, start, end));
  });
});
