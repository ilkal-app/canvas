import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from '../drawable/drawable-values.js';
import * as schema from '../index.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { sampleObject, sampleSharedFields } from './__fixtures__/object-samples.js';
import { baseObjectSchema } from './base-object.js';
import { boardObjectSchema } from './board-object.js';
import { OBJECT_TYPES } from './object-type.js';

/**
 * Reads a planned public constant while keeping this acceptance suite compilable before the
 * constant exists.
 *
 * @returns The object name schema version.
 * @throws {Error} When the planned export is absent.
 */
function objectNameVersion(): number {
  const value = (schema as unknown as Record<string, unknown>).OBJECT_NAME_VERSION;
  if (typeof value !== 'number') throw new Error('missing export: OBJECT_NAME_VERSION');
  return value;
}

describe('object names', () => {
  it('defines the optional bounded name on the shared base schema', () => {
    const base = { ...sampleSharedFields('base'), type: 'group' };
    expect(baseObjectSchema.safeParse(base).success).toBe(true);
    expect(baseObjectSchema.safeParse({ ...base, name: 'n'.repeat(200) }).success).toBe(true);
    expect(baseObjectSchema.safeParse({ ...base, name: 'n'.repeat(201) }).success).toBe(false);
  });

  for (const type of OBJECT_TYPES) {
    it(`${type} accepts an optional name of at most 200 characters`, () => {
      const sample = sampleObject(type, `named-${type}`);
      expect(boardObjectSchema.safeParse(sample).success).toBe(true);
      expect(boardObjectSchema.safeParse({ ...sample, name: '' }).success).toBe(true);
      expect(boardObjectSchema.safeParse({ ...sample, name: 'n'.repeat(200) }).success).toBe(true);
      expect(boardObjectSchema.safeParse({ ...sample, name: 'n'.repeat(201) }).success).toBe(false);
      expect(boardObjectSchema.safeParse({ ...sample, name: 42 }).success).toBe(false);
      if (type === 'frame' || type === 'component') {
        const { name: unused, ...withoutName } = sample as unknown as Record<string, unknown>;
        expect(unused).toBeDefined();
        expect(boardObjectSchema.safeParse(withoutName).success).toBe(false);
      }
    });
  }

  it('the relay door accepts absent and bounded string names, and refuses other values', () => {
    expect(drawableValuesReason('style', {})).toBeUndefined();
    expect(drawableValuesReason('style', { name: '' })).toBeUndefined();
    expect(drawableValuesReason('style', { name: 'n'.repeat(200) })).toBeUndefined();
    for (const name of ['n'.repeat(201), null, 12, false, []]) {
      expect(drawableValuesReason('style', { name })).toMatchObject({ field: 'name' });
    }
  });

  it('registers an identity migration as the current schema version', () => {
    const version = objectNameVersion();
    // The current version or an earlier one, once a later step lands.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(version);
    const fixture = { schemaVersion: version - 1, objects: [{ id: 'old', type: 'group' }] };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, version)).toEqual({
      ...before,
      schemaVersion: version,
    });
    expect(fixture).toEqual(before);
  });
});
