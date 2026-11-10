import { describe, expect, it } from 'vitest';

import { symbolCoverageFamilies } from './symbol-coverage.js';

describe('emoji face loading', () => {
  it('requests Noto Color Emoji for default emoji presentation and explicit VS16', () => {
    expect(symbolCoverageFamilies('👍')).toContain('Noto Color Emoji');
    expect(symbolCoverageFamilies('❤\ufe0f')).toContain('Noto Color Emoji');
  });

  it('does not load Noto Color Emoji for text presentation of a shared symbol', () => {
    expect(symbolCoverageFamilies('©')).not.toContain('Noto Color Emoji');
  });
});
