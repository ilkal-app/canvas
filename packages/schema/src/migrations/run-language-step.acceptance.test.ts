import { describe, expect, it } from 'vitest';

import * as versions from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

const { RUN_LANGUAGE_VERSION, SCHEMA_VERSION } = versions as unknown as Record<string, number>;

describe('run language schema step', () => {
  it('registers version 27 immediately after 26 as an identity migration', () => {
    expect(RUN_LANGUAGE_VERSION).toBe(27);
    // Bump-stable (took 28): 27 stays registered right after 26.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(27);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.slice(keys.indexOf(26), keys.indexOf(26) + 2)).toEqual([26, 27]);
    const before = { schemaVersion: 26, objects: [{ id: 'old', type: 'text', text: 'A' }] };
    const source = structuredClone(before);
    expect(runMigrations(source, MIGRATIONS, RUN_LANGUAGE_VERSION ?? 0)).toEqual({
      ...before,
      schemaVersion: 27,
    });
    expect(source.objects).toEqual(before.objects);
  });
});
