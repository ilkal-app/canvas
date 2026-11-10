import { describe, expect, it } from 'vitest';

import { OBJECT_NAME_VERSION, SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS, STROKE_ALIGN_VERSION } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// Every object may store a layer `name`; an older reader refuses one on a shape or text
// (objects are strict), so portable JSON names the version that may hold it. An object without
// one is unnamed. The step is registered under OBJECT_NAME_VERSION, so no test here pins the
// current version.

/** A board of the version before: an unnamed shape and a named frame. */
const FIXTURE = {
  schemaVersion: OBJECT_NAME_VERSION - 1,
  objects: [
    { id: 's', type: 'shape', kind: 'rectangle', fill: null, stroke: null, sides: 4 },
    { id: 'f', type: 'frame', name: 'Plan', clip: false, background: [1, 1, 1, 1] },
  ],
};

describe('the object name step', () => {
  it('follows the stroke alignment step, at a version up to the current one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(OBJECT_NAME_VERSION);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.indexOf(OBJECT_NAME_VERSION)).toBeGreaterThan(keys.indexOf(STROKE_ALIGN_VERSION));
  });

  it('is the identity on a document of the version before, without mutating it', () => {
    const fixture = structuredClone(FIXTURE);
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, OBJECT_NAME_VERSION)).toEqual({
      ...before,
      schemaVersion: OBJECT_NAME_VERSION,
    });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
