import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A text style's weight may be any of the nine CSS weights; a version 7 reader refuses
// 500 (its weight is 400 or 700), so portable JSON names the version that may hold it. Every
// version 7 weight is one of the nine.

describe('the font weights step', () => {
  it('is version 8 or later, after the text spacing step', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
    expect([...MIGRATIONS.keys()].slice(6, 8)).toEqual([7, 8]);
  });

  it('is the identity on a version 7 document, without mutating it', () => {
    const style = { fontFamily: 'Inter', fontSize: 16, color: 'ink', weight: 700, italic: false };
    const fixture = {
      schemaVersion: 7,
      objects: [{ id: 't', type: 'text', text: 'Hi', runs: [{ length: 2, style }] }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 8)).toEqual({ ...before, schemaVersion: 8 });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
