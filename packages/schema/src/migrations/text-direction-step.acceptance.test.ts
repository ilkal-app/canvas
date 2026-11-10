import { describe, expect, it } from 'vitest';

import * as versions from '../version/schema-version.js';

const { SCHEMA_VERSION, TEXT_DIRECTION_VERSION } = versions as unknown as Record<
  'SCHEMA_VERSION' | 'TEXT_DIRECTION_VERSION',
  number
>;

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('text direction schema step', () => {
  it('reserves version 25 immediately after 24 as an identity migration', () => {
    expect(TEXT_DIRECTION_VERSION).toBe(25);
    // A later version may follow 25 ('s 26); 25's step still comes right after 24's.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(TEXT_DIRECTION_VERSION);
    const versions = [...MIGRATIONS.keys()];
    expect(versions[versions.indexOf(TEXT_DIRECTION_VERSION) - 1]).toBe(24);
    const before = { schemaVersion: 24, objects: [{ id: 'old', type: 'text', align: 'left' }] };
    const source = structuredClone(before);
    expect(runMigrations(source, MIGRATIONS, TEXT_DIRECTION_VERSION)).toEqual({
      ...before,
      schemaVersion: 25,
    });
    expect(source.objects).toEqual(before.objects);
  });
});
