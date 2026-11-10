import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import * as versions from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

const { SCHEMA_VERSION, FONT_VARIATIONS_VERSION } = versions;

describe('font variations schema step', () => {
  it('adds one identity step after the previous version', () => {
    // A later version may follow ('s 27).
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(FONT_VARIATIONS_VERSION);
    expect((publicSchema as unknown as Record<string, unknown>).FONT_VARIATIONS_VERSION).toBe(
      FONT_VARIATIONS_VERSION,
    );
    expect(MIGRATIONS.has(FONT_VARIATIONS_VERSION)).toBe(true);
    const before = {
      schemaVersion: FONT_VARIATIONS_VERSION - 1,
      objects: [{ id: 'old', type: 'text', runs: [{ length: 1, style: { weight: 400 } }] }],
    };
    const source = structuredClone(before);
    expect(runMigrations(source, MIGRATIONS, FONT_VARIATIONS_VERSION)).toEqual({
      ...before,
      schemaVersion: FONT_VARIATIONS_VERSION,
    });
    expect(source).toEqual(before);
  });
});
