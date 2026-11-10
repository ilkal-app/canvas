import { describe, expect, it } from 'vitest';

import { NEGATIVE_GAP_VERSION, SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS, NAMED_STYLES_VERSION } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// An auto-layout's gap may be negative; an older reader's schema floors it at 0, so
// portable JSON names the version that may hold one. Every earlier gap is zero or more. The step is
// registered under NEGATIVE_GAP_VERSION, so no test here pins the current version.

/** A board of the version before: a frame laid out as a row with a gap of 8. */
const FIXTURE = {
  schemaVersion: NEGATIVE_GAP_VERSION - 1,
  objects: [
    {
      id: 'f',
      type: 'frame',
      name: 'Row',
      clip: false,
      background: null,
      autoLayout: {
        direction: 'row',
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        align: 'start',
        justify: 'start',
        width: 'hug',
        height: 'hug',
      },
    },
  ],
};

describe('the negative gap step', () => {
  it('follows the named styles step, at a version up to the current one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(NEGATIVE_GAP_VERSION);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.indexOf(NEGATIVE_GAP_VERSION)).toBeGreaterThan(keys.indexOf(NAMED_STYLES_VERSION));
  });

  it('is the identity on a document of the version before, without mutating it', () => {
    const fixture = structuredClone(FIXTURE);
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, NEGATIVE_GAP_VERSION)).toEqual({
      ...before,
      schemaVersion: NEGATIVE_GAP_VERSION,
    });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
