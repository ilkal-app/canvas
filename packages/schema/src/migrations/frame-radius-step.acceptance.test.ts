// Portable frame radius data starts at its named schema step.
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { FRAME_RADIUS_VERSION, MIGRATIONS, NAMED_STYLES_VERSION } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('frame radius schema step', () => {
  it('follows the named styles step and is an identity migration', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(FRAME_RADIUS_VERSION);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.indexOf(FRAME_RADIUS_VERSION)).toBe(keys.indexOf(NAMED_STYLES_VERSION) + 1);
    const before = {
      schemaVersion: FRAME_RADIUS_VERSION - 1,
      objects: [{ id: 'f', type: 'frame', name: 'Plan', clip: false, background: null }],
    };
    expect(runMigrations(structuredClone(before), MIGRATIONS, FRAME_RADIUS_VERSION)).toEqual({
      ...before,
      schemaVersion: FRAME_RADIUS_VERSION,
    });
  });
});
