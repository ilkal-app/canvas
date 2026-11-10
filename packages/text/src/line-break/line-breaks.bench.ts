import { bench, describe } from 'vitest';

import { lineBreakOpportunities } from './line-breaks.js';

// The cost of Unicode line breaking, which every layout now pays once per text: a
// 10,000-character page of Latin prose, of Japanese, and of Thai (whose words come from the
// runtime's dictionary segmenter). Gated by `pnpm bench:ci`'s micro-benchmarks.

const LATIN =
  'The quick brown fox jumps over the lazy dog, while self-aware typography keeps $12.50 apart. ';
const JAPANESE = '日本語の文章は単語の間に空白がありません。行は文字と文字の間で折り返されます。';
const THAI = 'ภาษาไทยไม่มีช่องว่างระหว่างคำ การตัดบรรทัดจึงใช้พจนานุกรมหาขอบเขตของคำ ';

/**
 * A text of `length` characters repeating a sentence.
 *
 * @param sentence - The sentence.
 * @param length - The length to reach.
 * @returns The text.
 */
function page(sentence: string, length: number): string {
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}

const latin = page(LATIN, 10_000);
const japanese = page(JAPANESE, 10_000);
const thai = page(THAI, 10_000);

describe('line break opportunities, 10k characters', () => {
  bench('Latin prose', () => {
    lineBreakOpportunities(latin);
  });
  bench('Japanese', () => {
    lineBreakOpportunities(japanese);
  });
  bench('Thai, by dictionary', () => {
    lineBreakOpportunities(thai);
  });
});
