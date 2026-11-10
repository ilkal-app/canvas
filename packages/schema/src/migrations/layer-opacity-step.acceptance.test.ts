// (layer opacity): portable layer opacity starts at the named schema step.
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS, LAYER_OPACITY_VERSION } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('layer opacity schema step', () => {
  it('is an identity step after the preceding schema step', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(LAYER_OPACITY_VERSION);
    const before = {
      schemaVersion: LAYER_OPACITY_VERSION - 1,
      objects: [{ id: 's', type: 'shape', fill: [1, 0, 0, 1] }],
    };
    expect(MIGRATIONS.has(LAYER_OPACITY_VERSION)).toBe(true);
    expect([...MIGRATIONS.keys()].indexOf(LAYER_OPACITY_VERSION)).toBe(
      [...MIGRATIONS.keys()].indexOf(LAYER_OPACITY_VERSION - 1) + 1,
    );
    expect(runMigrations(structuredClone(before), MIGRATIONS, LAYER_OPACITY_VERSION)).toEqual({
      ...before,
      schemaVersion: LAYER_OPACITY_VERSION,
    });
  });
});
