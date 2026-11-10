import { describe, expect, it } from 'vitest';

import { principalIdSchema } from './principal-id.js';

describe('guest principal ids', () => {
  it('accepts a guest id for an object creator', () => {
    expect(principalIdSchema.parse('guest:00000000-0000-4000-8000-000000000001')).toBe(
      'guest:00000000-0000-4000-8000-000000000001',
    );
  });

  it('still refuses unrecognized prefixes and malformed guest ids', () => {
    for (const id of ['service:ada', 'guest:', 'guest:has space', 'guest:a'.repeat(129)]) {
      expect(principalIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});
