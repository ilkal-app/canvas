// A move that is not an object is told so in zod's own words; only an unknown key, or neither or
// both forms, gets the two-form message.
import { describe, expect, it } from 'vitest';

import { moveObjectsInputSchema } from './move-objects.js';

describe('a move’s shape', () => {
  it('is told the expected type at its own path', () => {
    const parsed = moveObjectsInputSchema.safeParse({ moves: [5] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({ path: ['moves', 0], code: 'invalid_type' });
    expect(parsed.error?.issues[0]?.message).not.toContain('a move is');
  });
  it('reads a by-move with an undefined to as a by-move', () => {
    const parsed = moveObjectsInputSchema.safeParse({
      moves: [{ id: 'a', by: { x: 1, y: 0 }, to: undefined }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.moves[0]).toEqual({ id: 'a', by: { x: 1, y: 0 } });
    expect(parsed.data?.moves[0]).not.toHaveProperty('to');
  });
});
