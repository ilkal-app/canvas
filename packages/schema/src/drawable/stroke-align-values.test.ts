import { describe, expect, it } from 'vitest';

import { strokeAlignSchema } from '../fields/stroke-align.js';

import { strokeAlignValueReason } from './stroke-align-values.js';

describe('strokeAlignValueReason', () => {
  it('accepts absent and exactly the schema’s three alignments', () => {
    expect(strokeAlignValueReason(undefined)).toBeUndefined();
    for (const align of ['inside', 'center', 'outside']) {
      expect(strokeAlignValueReason(align)).toBeUndefined();
      expect(strokeAlignSchema.safeParse(align).success).toBe(true);
    }
  });

  it('refuses anything else as out of range, as the schema does', () => {
    for (const value of [null, 'Inside', 'middle', '', 0, 0.5, true, [], {}]) {
      expect(strokeAlignValueReason(value)).toEqual({ field: '', reason: 'out-of-range' });
      expect(strokeAlignSchema.safeParse(value).success).toBe(false);
    }
  });
});
