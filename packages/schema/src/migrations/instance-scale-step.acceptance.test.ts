import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('instance scale schema step', () => {
  it('registers the named version after frame radius', () => {
    const version = Reflect.get(schema, 'INSTANCE_SCALE_VERSION') as number | undefined;
    if (version === undefined) throw new Error('missing export: INSTANCE_SCALE_VERSION');
    expect(Number.isInteger(version)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(version);
    expect(MIGRATIONS.has(version)).toBe(true);
    expect(version).toBeGreaterThan(schema.FRAME_RADIUS_VERSION);
  });

  it('is an identity step and leaves absent scale absent', () => {
    const version = Reflect.get(schema, 'INSTANCE_SCALE_VERSION') as number | undefined;
    if (version === undefined) throw new Error('missing export: INSTANCE_SCALE_VERSION');
    const before = {
      schemaVersion: version - 1,
      objects: [
        { id: 'inst', type: 'instance', mainId: 'main', width: 200, height: 100, overrides: {} },
      ],
    };
    const frozen = structuredClone(before);
    expect(runMigrations(before, MIGRATIONS, version)).toEqual({
      ...frozen,
      schemaVersion: version,
    });
    expect(before).toEqual(frozen);
  });
});
