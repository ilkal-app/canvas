import { bench, describe } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

// The cost of shaping: the same page laid out per codepoint (today's layout) and shaped
// by HarfBuzz, and the re-layout a keystroke pays in a long text. Gated by `pnpm bench:ci`'s
// micro-benchmarks.

const SENTENCE =
  'The quick brown fox jumps over the lazy dog while office affine Typography keeps its kerning. ';

const base: TextStyle = {
  fontFamily: 'DM Sans',
  fontSize: 16,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

/**
 * A text of about `glyphs` characters, a bold heading run at its start.
 *
 * @param glyphs - The length to reach.
 * @returns The text and its runs.
 */
function page(glyphs: number): { text: string; runs: StyleRun[] } {
  const text = SENTENCE.repeat(Math.ceil(glyphs / SENTENCE.length)).slice(0, glyphs);
  const heading = 40;
  const runs: StyleRun[] = [
    { length: heading, style: { ...base, fontSize: 24, weight: 700 } },
    { length: text.length - heading, style: base },
  ];
  return { text, runs };
}

const font = acceptanceFont('dm-sans');
const metrics = createMetricsMeasurer([font.metrics]);
const shaping = createShapingMeasurer(await loadShaper(), [font]);

// A page of 10k glyphs, wrapped at 600 px.
const tenThousand = page(10_000);
// A 2,000-word text (about 12k characters); a keystroke re-lays it out with one more character.
const twoThousandWords = page(12_000);
let keystroke = 0;

describe('text layout, shaped', () => {
  bench('10k-glyph page, per codepoint', () => {
    layoutText(tenThousand.text, tenThousand.runs, 600, metrics);
  });

  bench('10k-glyph page, shaped', () => {
    layoutText(tenThousand.text, tenThousand.runs, 600, shaping);
  });

  bench('2,000-word text, a keystroke, shaped', () => {
    keystroke = (keystroke + 1) % 26;
    const typed = `${twoThousandWords.text}${String.fromCharCode(0x61 + keystroke)}`;
    const runs: StyleRun[] = [
      ...twoThousandWords.runs.slice(0, -1),
      { length: typed.length - 40, style: base },
    ];
    layoutText(typed, runs, 600, shaping);
  });
});
