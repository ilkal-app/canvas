import { describe, expect, it } from 'vitest';

import { AUTO_LAYOUT_SCHEMA_VERSION, SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

describe('the auto-layout schema migration', () => {
  it('registers the version that introduced optional layout fields', () => {
    expect(Number.isInteger(AUTO_LAYOUT_SCHEMA_VERSION)).toBe(true);
    expect(AUTO_LAYOUT_SCHEMA_VERSION).toBeGreaterThan(1);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(AUTO_LAYOUT_SCHEMA_VERSION);
    expect(MIGRATIONS.has(AUTO_LAYOUT_SCHEMA_VERSION)).toBe(true);
  });

  it('changes only the version of the preceding document and never mutates it', () => {
    const fixture = {
      schemaVersion: AUTO_LAYOUT_SCHEMA_VERSION - 1,
      pages: [{ id: 'page-1', name: 'Page 1' }],
      objects: [{ id: 'frame-one', type: 'frame', name: 'Panel', children: ['text-one'] }],
      extra: { unknownPortableField: true },
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, AUTO_LAYOUT_SCHEMA_VERSION)).toEqual({
      ...before,
      schemaVersion: AUTO_LAYOUT_SCHEMA_VERSION,
    });
    expect(fixture).toEqual(before);
  });

  it('keeps optional layout fields absent on older objects when brought to latest', () => {
    const fixture = {
      schemaVersion: AUTO_LAYOUT_SCHEMA_VERSION - 1,
      objects: [{ id: 'frame-one', type: 'frame', name: 'Panel' }],
    };
    const migrated = migrateToLatest(fixture);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.objects).toEqual(fixture.objects);
    expect(fixture.schemaVersion).toBe(AUTO_LAYOUT_SCHEMA_VERSION - 1);
  });
});
