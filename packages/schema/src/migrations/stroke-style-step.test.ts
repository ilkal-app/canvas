import { describe, expect, it } from 'vitest';

import { pathObjectSchema } from '../objects/path-object.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS, STROKE_STYLE_VERSION } from './migration-registry.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

// A path, line or connector may store `strokeDash`, `strokeJoin`, `strokeMiterLimit`
// and `strokeCap`; an older reader refuses them (its objects are strict), so portable JSON names
// the version that may hold them. An object without them draws as before.

describe('the stroke style step', () => {
  it('is registered after the frame name step, at a version up to the current one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(STROKE_STYLE_VERSION);
    const versions = [...MIGRATIONS.keys()];
    expect(versions.indexOf(STROKE_STYLE_VERSION)).toBeGreaterThan(versions.indexOf(6));
  });

  it('is the identity on a document of the version before, without mutating it', () => {
    const fixture = {
      schemaVersion: STROKE_STYLE_VERSION - 1,
      objects: [{ id: 'p', type: 'path', stroke: { color: [0, 0, 0, 1], width: 2 } }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, STROKE_STYLE_VERSION)).toEqual({
      ...before,
      schemaVersion: STROKE_STYLE_VERSION,
    });
    expect(migrateToLatest(fixture)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
    expect(fixture).toEqual(before);
  });

  it('lets a path carry the new fields, and one without them stays valid', () => {
    const path = {
      id: 'p',
      type: 'path',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:u',
      createdAt: 0,
      updatedAt: 0,
      vertices: [],
      segments: [],
      stroke: { color: [0, 0, 0, 1], width: 2 },
      fill: null,
    };
    expect(pathObjectSchema.safeParse(path).error?.issues ?? []).toEqual([]);
    const styled = {
      ...path,
      strokeDash: { pattern: [4, 2], offset: 1 },
      strokeJoin: 'miter',
      strokeMiterLimit: 10,
      strokeCap: 'square',
    };
    expect(pathObjectSchema.safeParse(styled).error?.issues ?? []).toEqual([]);
  });
});
