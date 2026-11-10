// Acceptance: portable boards retain slot policy and selected main.
import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';

import { component, instance, shape } from '../instances/__fixtures__/component-board.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

describe('portable instance swap', () => {
  it('exports the swap schema version with an identity migration', () => {
    expect(schema.SCHEMA_VERSION).toBeGreaterThanOrEqual(SWAP_SCHEMA_VERSION);
    expect(schema.MIGRATIONS.has(SWAP_SCHEMA_VERSION)).toBe(true);
    expect(
      schema.MIGRATIONS.get(SWAP_SCHEMA_VERSION - 1)?.({
        schemaVersion: SWAP_SCHEMA_VERSION - 1,
        objects: [],
      }),
    ).toMatchObject({ objects: [] });
  });

  it('round-trips swap options and a selected main through portable JSON', () => {
    const input = {
      format: PORTABLE_BOARD_FORMAT,
      schemaVersion: schema.SCHEMA_VERSION,
      objects: [
        component('icon-a'),
        shape('a-path', 'icon-a'),
        component('icon-b'),
        shape('b-path', 'icon-b'),
        component('button'),
        instance('slot', 'icon-a', { parentId: 'button', swapOptions: ['icon-a', 'icon-b'] }),
        instance('placed', 'button', { overrides: { slot: { mainId: 'icon-b' } } }),
      ],
    };
    const exported = exportBoard(importBoard(input));
    const imported = importBoard(exported);
    expect(imported.objects.get('slot' as schema.ObjectId)).toMatchObject({
      swapOptions: ['icon-a', 'icon-b'],
    });
    expect(imported.objects.get('placed' as schema.ObjectId)).toMatchObject({
      overrides: { slot: { mainId: 'icon-b' } },
    });
    expect(exportBoard(imported)).toEqual(exported);
  });
});
const SWAP_SCHEMA_VERSION = Reflect.get(schema, 'SWAP_SCHEMA_VERSION') as number;
