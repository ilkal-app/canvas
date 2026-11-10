import { describe, expect, it } from 'vitest';

import { principalIdSchema } from './principal-id.js';

describe('demo visitor principal ids', () => {
  it('accepts a demo visitor id, a read-only local origin', () => {
    expect(principalIdSchema.parse('demo:9b2f7a3e-1c4d-4e5f-8a6b-7c8d9e0f1a2b')).toBe(
      'demo:9b2f7a3e-1c4d-4e5f-8a6b-7c8d9e0f1a2b',
    );
  });

  it('refuses a malformed demo id', () => {
    for (const id of ['demo', 'demo:', 'demo:has space', 'demo:a'.repeat(129)]) {
      expect(principalIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});
