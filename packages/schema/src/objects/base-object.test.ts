import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { INVALID_Z_KEYS } from '../z-order/__fixtures__/invalid-z-keys.js';
import { MAX_KEY_LENGTH } from '../z-order/key-rule.js';

import { sampleSharedFields } from './__fixtures__/object-samples.js';
import { baseObjectSchema } from './base-object.js';
import { OBJECT_TYPES } from './object-type.js';

describe('OBJECT_TYPES', () => {
  it('lists the stored object types, including reusable components', () => {
    expect(OBJECT_TYPES).toEqual([
      'text',
      'sticky',
      'image',
      'video',
      'shape',
      'line',
      'connector',
      'path',
      'freehand',
      'group',
      'frame',
      'comment',
      'component',
      'instance',
      'link',
    ]);
  });
});

describe('baseObjectSchema', () => {
  const valid = { ...sampleSharedFields('base-1'), type: 'group' };

  it('accepts the shared fields', () => {
    expect(baseObjectSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a parent id, a negative position and a rotation in radians', () => {
    expect(
      baseObjectSchema.safeParse({ ...valid, parentId: 'frame-1', x: -5, rotation: -Math.PI })
        .success,
    ).toBe(true);
  });

  it('rejects an empty fractional index, which could not be ordered', () => {
    expect(baseObjectSchema.safeParse({ ...valid, z: '' }).success).toBe(false);
  });

  it.each(INVALID_Z_KEYS)('rejects a z that is not a fractional-index key: %s', (label, key) => {
    const result = baseObjectSchema.safeParse({ ...valid, z: key });
    expect(result.success, label).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['z']]);
  });

  it('states the length cap and the character set of z in its JSON Schema', () => {
    expect(z.toJSONSchema(baseObjectSchema).properties?.z).toMatchObject({
      type: 'string',
      maxLength: MAX_KEY_LENGTH,
      pattern: '^[0-9A-Za-z]+$',
    });
  });

  it('accepts a z of up to MAX_KEY_LENGTH characters', () => {
    const longest = `a0${'V'.repeat(MAX_KEY_LENGTH - 2)}`;
    expect(baseObjectSchema.safeParse({ ...valid, z: longest }).success).toBe(true);
    expect(baseObjectSchema.safeParse({ ...valid, z: 'Zz' }).success).toBe(true);
  });

  it('rejects a fractional timestamp, a negative timestamp and an infinite coordinate', () => {
    expect(baseObjectSchema.safeParse({ ...valid, createdAt: 1.5 }).success).toBe(false);
    expect(baseObjectSchema.safeParse({ ...valid, updatedAt: -1 }).success).toBe(false);
    expect(baseObjectSchema.safeParse({ ...valid, x: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
  });

  it('rejects an unknown type and an unknown key', () => {
    expect(baseObjectSchema.safeParse({ ...valid, type: 'widget' }).success).toBe(false);
    expect(baseObjectSchema.safeParse({ ...valid, colour: 'red' }).success).toBe(false);
  });

  it('rejects an object missing a shared field', () => {
    const withoutLocked = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'locked'),
    );
    expect(baseObjectSchema.safeParse(withoutLocked).success).toBe(false);
  });
});
