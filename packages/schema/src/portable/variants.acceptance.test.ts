// Acceptance
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, VARIANTS_SCHEMA_VERSION, MIGRATIONS } from '../index.js';
import { component, instance, shape } from '../instances/__fixtures__/component-board.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

describe('portable variant board', () => {
  it('round-trips axes, presets, an instance selection and a nested selection', () => {
    // A later schema ('s swap) builds on this one; variants stay readable at the current.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(VARIANTS_SCHEMA_VERSION);
    expect(MIGRATIONS.has(VARIANTS_SCHEMA_VERSION - 1)).toBe(true);
    expect(
      MIGRATIONS.get(VARIANTS_SCHEMA_VERSION - 1)?.({
        schemaVersion: VARIANTS_SCHEMA_VERSION - 1,
        objects: [],
      }),
    ).toMatchObject({ objects: [] });
    const objects = [
      component('inner'),
      shape('leaf', 'inner'),
      component('main', {
        variantAxes: [{ name: 'State', values: ['Idle', 'Busy'] }],
        variantPresets: {
          'State=Busy': { box: { fill: [1, 0, 0, 1] }, nested: { variant: { State: 'Busy' } } },
        },
      }),
      shape('box', 'main'),
      instance('nested', 'inner', { parentId: 'main' }),
      instance('placed', 'main', {
        variant: { State: 'Busy' },
        overrides: { nested: { variant: { State: 'Idle' } } },
      }),
    ];
    const input = { format: PORTABLE_BOARD_FORMAT, schemaVersion: SCHEMA_VERSION, objects };
    const exported = exportBoard(importBoard(input));
    const reimported = importBoard(exported);
    expect(exportBoard(reimported)).toEqual(exported);
    const values = [...reimported.objects.values()];
    expect(values.find((object) => object.id === 'main')).toMatchObject({
      variantAxes: [{ name: 'State', values: ['Idle', 'Busy'] }],
      variantPresets: {
        'State=Busy': { box: { fill: [1, 0, 0, 1] }, nested: { variant: { State: 'Busy' } } },
      },
    });
    expect(values.find((object) => object.id === 'placed')).toMatchObject({
      variant: { State: 'Busy' },
      overrides: { nested: { variant: { State: 'Idle' } } },
    });
  });
});
