import { describe, expect, it } from 'vitest';

import * as versions from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

const { TEXT_LISTS_SCHEMA_VERSION, SCHEMA_VERSION } = versions as unknown as Record<string, number>;

describe('text lists schema migration', () => {
  it('registers 38 immediately after 37 as an identity migration without mutating input', () => {
    expect(TEXT_LISTS_SCHEMA_VERSION).toBe(38);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(38);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.slice(keys.indexOf(37), keys.indexOf(37) + 2)).toEqual([37, 38]);
    const before = { schemaVersion: 37, objects: [{ id: 'old', type: 'text', text: 'A' }] };
    const source = structuredClone(before);
    expect(runMigrations(source, MIGRATIONS, 38)).toEqual({ ...before, schemaVersion: 38 });
    expect(source).toEqual(before);
  });
});
