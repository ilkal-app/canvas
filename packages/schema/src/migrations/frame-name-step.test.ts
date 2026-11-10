import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A frame may store `showName`; a version 5 reader refuses it (its object is strict), so
// portable JSON names the version that may hold it. A frame without it keeps its default.

describe('the schema 6 step', () => {
  it('is version 6 or later, after the text override step (raised it to 7)', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    expect([...MIGRATIONS.keys()].slice(4, 6)).toEqual([5, 6]);
  });

  it('is the identity on a version 5 document, without mutating it', () => {
    const fixture = {
      schemaVersion: 5,
      objects: [{ id: 'f', type: 'frame', parentId: 'outer', name: 'Panel' }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 6)).toEqual({ ...before, schemaVersion: 6 });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
