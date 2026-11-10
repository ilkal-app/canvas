// Acceptance
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { boardOf, component, instance, shape } from '../instances/__fixtures__/component-board.js';
import { STROKE_ALIGN_VERSION } from '../migrations/migration-registry.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const PRESET_GEOMETRY_SCHEMA_VERSION = Reflect.get(
  schema,
  'PRESET_GEOMETRY_SCHEMA_VERSION',
) as number;

describe('preset geometry portable version', () => {
  it('exports the next schema version and an identity migration', () => {
    // A later version may follow; this one stays in the build.
    expect(PRESET_GEOMETRY_SCHEMA_VERSION).toBeLessThanOrEqual(schema.SCHEMA_VERSION);
    expect(PRESET_GEOMETRY_SCHEMA_VERSION).toBe(STROKE_ALIGN_VERSION + 1);
    const previous = { schemaVersion: PRESET_GEOMETRY_SCHEMA_VERSION - 1, objects: [] };
    expect(schema.MIGRATIONS.get(PRESET_GEOMETRY_SCHEMA_VERSION)?.(previous)).toMatchObject({
      objects: [],
    });
  });

  it('round-trips plain geometry records in a preset and an instance', () => {
    const main = component('main', {
      width: 40,
      height: 40,
      variantAxes: [{ name: 'Icon', values: ['20', '24'] }],
      variantPresets: {
        'Icon=24': { main: { width: 48 }, icon: { x: 8, y: 8, width: 24, height: 24 } },
      },
    });
    const placed = instance('inst', 'main', {
      width: 40,
      height: 40,
      variant: { Icon: '24' },
      overrides: { icon: { x: 9 } },
    });
    const input = {
      format: PORTABLE_BOARD_FORMAT,
      schemaVersion: schema.SCHEMA_VERSION,
      objects: [...boardOf([main, shape('icon', 'main'), placed]).objects.values()],
    };
    const exported = exportBoard(importBoard(input));
    expect(exportBoard(importBoard(exported))).toEqual(exported);
    expect(importBoard(exported).objects.get(main.id)).toMatchObject({
      variantPresets: { 'Icon=24': { main: { width: 48 }, icon: { width: 24 } } },
    });
    expect(importBoard(exported).objects.get(placed.id)).toMatchObject({
      overrides: { icon: { x: 9 } },
    });
  });
});
