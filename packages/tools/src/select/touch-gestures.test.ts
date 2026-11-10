import { describe, expect, it } from 'vitest';

import { isLongPress, LONG_PRESS_MS } from './touch-gestures.js';

describe('isLongPress', () => {
  it('holds from 500 ms after the finger landed, not a millisecond before', () => {
    expect(LONG_PRESS_MS).toBe(500);
    expect(isLongPress(1_000, 1_499)).toBe(false);
    expect(isLongPress(1_000, 1_500)).toBe(true);
  });
});
