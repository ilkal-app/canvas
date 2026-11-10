import { describe, expect, it } from 'vitest';

import { rgbaSchema } from './color.js';
import { strokeSchema } from './stroke.js';

describe('rgbaSchema', () => {
  it('accepts four channels in 0 to 1 and rejects three channels or an out-of-range channel', () => {
    expect(rgbaSchema.safeParse([0, 0.5, 1, 1]).success).toBe(true);
    expect(rgbaSchema.safeParse([0, 0.5, 1]).success).toBe(false);
    expect(rgbaSchema.safeParse([0, 0.5, 1, 1.5]).success).toBe(false);
    expect(rgbaSchema.safeParse([0, 0.5, 1, Number.NaN]).success).toBe(false);
  });
});

describe('strokeSchema', () => {
  it('accepts a width in (0, 64] world px', () => {
    expect(strokeSchema.safeParse({ color: [0, 0, 0, 1], width: 64 }).success).toBe(true);
    expect(strokeSchema.safeParse({ color: [0, 0, 0, 1], width: 0.5 }).success).toBe(true);
  });

  it('rejects a zero, negative, too wide or infinite width', () => {
    for (const width of [0, -1, 65, Number.POSITIVE_INFINITY]) {
      expect(strokeSchema.safeParse({ color: [0, 0, 0, 1], width }).success).toBe(false);
    }
  });

  it('rejects unknown keys, so a malformed agent call cannot smuggle fields in', () => {
    expect(strokeSchema.safeParse({ color: [0, 0, 0, 1], width: 1, dash: [4, 4] }).success).toBe(
      false,
    );
  });
});
