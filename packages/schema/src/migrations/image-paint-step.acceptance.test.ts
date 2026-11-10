// PR 1: the newest portable migration is an identity step for image paints.
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('image paint schema step', () => {
  it('adds one identity step from the previous schema version', () => {
    const fixture = {
      schemaVersion: SCHEMA_VERSION - 1,
      objects: [{ id: 'shape', type: 'shape', fill: [1, 0, 0, 1] }],
    };
    const before = structuredClone(fixture);
    expect(MIGRATIONS.get(SCHEMA_VERSION)).toBeTypeOf('function');
    expect(runMigrations(fixture, MIGRATIONS, SCHEMA_VERSION)).toEqual({
      ...before,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(fixture).toEqual(before);
  });
});
