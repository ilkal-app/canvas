import { expect, it } from 'vitest';

import { coverageFamilies } from './script-coverage.js';

it('requests no coverage for Latin and only the scripts actually present in mixed text', () => {
  expect(coverageFamilies('Hello World')).toEqual([]);
  expect(coverageFamilies('Hello 中文 שלום')).toEqual(['Noto Sans SC', 'Noto Sans Hebrew']);
  expect(coverageFamilies('مرحبا नमस्ते ไทย')).toEqual([
    'Noto Sans Arabic',
    'Noto Sans Devanagari',
    'Noto Sans Thai',
  ]);
});
