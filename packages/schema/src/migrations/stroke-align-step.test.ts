import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { DROP_SHADOW_VERSION, MIGRATIONS, STROKE_ALIGN_VERSION } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A shape or frame may store `strokeAlign`, and a frame a `stroke`; an older reader
// refuses them (objects are strict), so portable JSON names the version that may hold them. A
// shape without an alignment strokes inside its edge, and a frame without a stroke draws none.
// The step is registered under STROKE_ALIGN_VERSION, so no test here pins the current version.

/** A board of the version before: a stroked shape and a frame, neither aligned nor outlined. */
const FIXTURE = {
  schemaVersion: STROKE_ALIGN_VERSION - 1,
  objects: [
    {
      id: 's',
      type: 'shape',
      kind: 'rectangle',
      fill: null,
      stroke: { color: 'ink', width: 2 },
      sides: 4,
    },
    { id: 'f', type: 'frame', name: 'Plan', clip: false, background: [1, 1, 1, 1] },
  ],
};

describe('the stroke alignment step', () => {
  it('follows the drop shadow step, at a version up to the current one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(STROKE_ALIGN_VERSION);
    const keys = [...MIGRATIONS.keys()];
    expect(keys.indexOf(STROKE_ALIGN_VERSION)).toBe(keys.indexOf(DROP_SHADOW_VERSION) + 1);
  });

  it('is the identity on a document of the version before, without mutating it', () => {
    const fixture = structuredClone(FIXTURE);
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, STROKE_ALIGN_VERSION)).toEqual({
      ...before,
      schemaVersion: STROKE_ALIGN_VERSION,
    });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });
});
