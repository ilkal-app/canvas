import { describe, expect, it } from 'vitest';

import { objectIdSchema } from '@canvas/schema';

import { createRandomObjectId } from './random-object-id.js';

describe('createRandomObjectId', () => {
  it('makes valid object ids of 21 characters', () => {
    const objectId = createRandomObjectId();
    expect(objectIdSchema.safeParse(objectId).success).toBe(true);
    expect(objectId).toHaveLength(21);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => createRandomObjectId()));
    expect(ids.size).toBe(10_000);
  });
});
