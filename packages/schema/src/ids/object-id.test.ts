import { describe, expect, it } from 'vitest';

import { assetIdSchema } from './asset-id.js';
import { objectIdSchema } from './object-id.js';
import { principalIdSchema } from './principal-id.js';

describe('objectIdSchema', () => {
  it('accepts opaque ids made of letters, digits, underscore and hyphen', () => {
    for (const id of [
      'a',
      'box-1',
      'V1StGXR8_Z5jdHi6B-myT',
      '0f8fad5b-d9cb-469f-a165-70867728950e',
    ]) {
      expect(objectIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejects empty, overlong, whitespace and punctuation ids', () => {
    for (const id of ['', 'a'.repeat(65), 'has space', 'a/b', 'a:b', 7, null]) {
      expect(objectIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe('assetIdSchema', () => {
  it('accepts a SHA-256 hex digest and rejects an empty string', () => {
    expect(
      assetIdSchema.safeParse('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
        .success,
    ).toBe(true);
    expect(assetIdSchema.safeParse('').success).toBe(false);
  });
});

describe('principalIdSchema', () => {
  it('accepts user and agent principals and the system principal', () => {
    for (const id of ['user:ada', 'agent:layout-bot', 'system']) {
      expect(principalIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejects the undo origin, a bare id, an empty id part and whitespace', () => {
    for (const id of ['undo', 'ada', 'user:', 'agent: bot', 'user:a b', '']) {
      expect(principalIdSchema.safeParse(id).success).toBe(false);
    }
  });
});
