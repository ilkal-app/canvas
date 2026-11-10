import { describe, expect, it } from 'vitest';

import * as publicSchema from '../index.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import * as versions from '../version/schema-version.js';

import { frame, OUTLINE } from './__fixtures__/component-board.js';
import { byId, fullBoard, RED, resolve } from './__fixtures__/resolved-board.js';
import { applyInstanceOverride, instanceOverrideFields } from './override-content.js';

const BLUE = [0, 0, 1, 1] as const;

describe('frame paint overrides', () => {
  it('offers fill and strokeColor on a frame child', () => {
    expect(instanceOverrideFields(frame('inner', 'main'))).toEqual(
      expect.arrayContaining(['fill', 'strokeColor']),
    );
  });

  it('replaces a frame background and existing stroke through instance resolution', () => {
    const board = fullBoard({ overrides: { inner: { fill: RED, strokeColor: BLUE } } }, [
      frame('inner', 'main', { background: [1, 1, 1, 1], stroke: OUTLINE }),
    ]);
    expect(byId(resolve(board).objects, 'inst/inner')).toMatchObject({
      background: RED,
      stroke: { ...OUTLINE, color: BLUE },
    });
  });

  it('accepts a token fill and never adds a stroke to a stroke-free frame', () => {
    const token = { token: 'surface_sheet' } as const;
    const source = frame('inner', 'main', { background: null, stroke: null });
    const resolved = applyInstanceOverride(source, { fill: token, strokeColor: RED });
    expect(resolved).toMatchObject({ background: token, stroke: null });
    expect(source).toMatchObject({ background: null, stroke: null });
  });

  it('registers schema 29 as an identity migration', () => {
    const step = (versions as unknown as Record<string, number>).FRAME_PAINT_OVERRIDE_VERSION;
    expect(step).toBe(29);
    // Bump-stable (took 30): this build writes schema 29 or later.
    expect(versions.SCHEMA_VERSION).toBeGreaterThanOrEqual(29);
    expect((publicSchema as unknown as Record<string, unknown>).FRAME_PAINT_OVERRIDE_VERSION).toBe(
      29,
    );
    expect(MIGRATIONS.has(29)).toBe(true);
    const before = { schemaVersion: 28, objects: [{ id: 'old', type: 'frame' }] };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 29)).toEqual({ ...before, schemaVersion: 29 });
    expect(input).toEqual(before);
  });
});
