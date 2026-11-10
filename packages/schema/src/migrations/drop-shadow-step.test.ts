import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { DROP_SHADOW_VERSION, MIGRATIONS, STROKE_STYLE_VERSION } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A shape or frame may store a drop `shadow`; an older reader refuses it (objects
// are strict), so portable JSON names the version that may hold it. An object without one draws
// none. The step is registered under DROP_SHADOW_VERSION, so no test here pins the current
// version.

/** A board of the version before: a shape and a frame, neither with a shadow. */
const FIXTURE = {
  schemaVersion: DROP_SHADOW_VERSION - 1,
  objects: [
    { id: 's', type: 'shape', kind: 'star', fill: [1, 0, 0, 1], stroke: null, sides: 5 },
    { id: 'f', type: 'frame', name: 'Plan', clip: true, background: [1, 1, 1, 1] },
  ],
};

describe('the drop shadow step', () => {
  it('follows the stroke style step, at a version up to the current one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(DROP_SHADOW_VERSION);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.indexOf(DROP_SHADOW_VERSION)).toBe(keys.indexOf(STROKE_STYLE_VERSION) + 1);
  });

  it('is the identity on a document of the version before, without mutating it', () => {
    const fixture = structuredClone(FIXTURE);
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, DROP_SHADOW_VERSION)).toEqual({
      ...before,
      schemaVersion: DROP_SHADOW_VERSION,
    });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
