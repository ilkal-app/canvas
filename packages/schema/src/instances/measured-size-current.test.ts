import { describe, expect, it } from 'vitest';

import { isMeasuredSizeCurrent } from './effective-overrides.js';

describe('isMeasuredSizeCurrent', () => {
  const size = { width: 40, height: 16 };

  it('holds only for a size measured with the fonts in use', () => {
    expect(
      isMeasuredSizeCurrent({ text: 'Hi', measuredSize: { ...size, fonts: 'abc' } }, 'abc'),
    ).toBe(true);
    expect(
      isMeasuredSizeCurrent({ text: 'Hi', measuredSize: { ...size, fonts: 'old' } }, 'abc'),
    ).toBe(false);
  });

  it('is stale with no fingerprint recorded, and false with no size at all', () => {
    expect(isMeasuredSizeCurrent({ text: 'Hi', measuredSize: size }, 'abc')).toBe(false);
    expect(isMeasuredSizeCurrent({ text: 'Hi' }, 'abc')).toBe(false);
  });
});
