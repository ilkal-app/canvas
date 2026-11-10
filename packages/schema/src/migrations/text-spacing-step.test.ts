import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A text style may store `letterSpacing` and `lineHeight`; a version 6 reader refuses
// them (its style is strict), so portable JSON names the version that may hold them. A run
// without them keeps no spacing and an auto line-height.

describe('the schema 7 step', () => {
  it('is version 7 or later, after the frame name step', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    expect([...MIGRATIONS.keys()].slice(5, 7)).toEqual([6, 7]);
  });

  it('is the identity on a version 6 document, without mutating it', () => {
    const style = { fontFamily: 'Inter', fontSize: 16, color: 'ink', weight: 400, italic: false };
    const fixture = {
      schemaVersion: 6,
      objects: [{ id: 't', type: 'text', text: 'Hi', runs: [{ length: 2, style }] }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 7)).toEqual({ ...before, schemaVersion: 7 });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
