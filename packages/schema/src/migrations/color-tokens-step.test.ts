import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A colour may name a token and a container may set `colorMode`; a version 10 reader
// refuses both (its schemas are strict), so portable JSON names the version that may hold them.

describe('the schema 11 step', () => {
  it('follows a step for every version up to it', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    for (const version of [8, 9, 10, 11]) expect(MIGRATIONS.has(version)).toBe(true);
  });

  it('is the identity on a version 10 document, without mutating it', () => {
    const fixture = {
      schemaVersion: 10,
      objects: [{ id: 's', type: 'shape', fill: [1, 0, 0, 1], stroke: { color: 'ink', width: 2 } }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 11)).toEqual({ ...before, schemaVersion: 11 });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
