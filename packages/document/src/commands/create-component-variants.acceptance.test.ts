// Acceptance
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA, BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createChild, newRectangle } from './__fixtures__/component-boards.js';
import { codesOf, fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const AXES = [
  { name: 'state', values: ['rest', 'hover'] },
  { name: 'size', values: ['small', 'large'] },
];

/**
 * Creates one selectable rectangle on a store.
 *
 * @param store - The target store.
 */
function seed(store: YjsDocumentStore): void {
  createChild(store, newRectangle('part', null, { x: 20, y: 30, width: 120, height: 60 }));
}

/**
 * Reads the component's variant fields without presuming the new input type exists yet.
 *
 * @param store - The target store.
 * @returns The stored axes and presets.
 */
function fields(store: YjsDocumentStore): { axes: unknown; presets: unknown } {
  return {
    axes: fieldOf(store, 'main', 'variantAxes'),
    presets: fieldOf(store, 'main', 'variantPresets'),
  };
}

/**
 * Creates the main through the command registry with optional axes.
 *
 * @param store - The target store.
 * @param variantAxes - Optional axes.
 */
function create(store: YjsDocumentStore, variantAxes?: unknown): void {
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['part'],
    name: 'Card',
    componentId: 'main',
    ...(variantAxes === undefined ? {} : { variantAxes }),
  });
}

describe('createComponent variant axes', () => {
  it('writes every empty preset in the same transaction as the axes', () => {
    const store = new YjsDocumentStore();
    seed(store);
    create(store, AXES);
    expect(fields(store)).toEqual({
      axes: AXES,
      presets: { 'state=rest': {}, 'state=hover': {}, 'size=small': {}, 'size=large': {} },
    });
  });

  it('accepts an explicit empty axis list and stores an empty preset map', () => {
    const store = new YjsDocumentStore();
    seed(store);
    create(store, []);
    expect(fields(store)).toEqual({ axes: [], presets: {} });
  });

  it('leaves both fields absent when axes are omitted', () => {
    const store = new YjsDocumentStore();
    seed(store);
    create(store);
    expect(fields(store)).toEqual({ axes: undefined, presets: undefined });
  });

  it.each([
    Array.from({ length: 9 }, (unused, index) => ({
      name: `axis${String(index)}`,
      values: ['on'],
    })),
    [{ name: 'state', values: Array.from({ length: 33 }, (unused, index) => `v${String(index)}`) }],
    [{ name: 'x'.repeat(65), values: ['on'] }],
    [{ name: 'state', values: ['x'.repeat(65)] }],
  ])('refuses an over-limit axis schema without a write', (variantAxes) => {
    const store = new YjsDocumentStore();
    seed(store);
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('createComponent'), {
          ids: ['part'],
          name: 'Card',
          componentId: 'main',
          variantAxes,
        }),
      ),
    ).toContain('invalid-input');
  });

  it('creates the main and its empty presets in one undo step', () => {
    const store = new YjsDocumentStore();
    seed(store);
    const history = createHistory(store, ADA.principalId);
    create(store, AXES);
    expect(fields(store).presets).toHaveProperty('state=hover', {});
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(store.get('part' as never)?.parentId).toBeNull();
    expect(store.get('main' as never)).toMatchObject({ retired: true });
    history.destroy();
  });

  it.each([
    [1, 2],
    [2, 1],
  ])(
    'preserves concurrent first edits to distinct precreated presets (client ids %i/%i)',
    (adaId, bobId) => {
      const ada = new YjsDocumentStore({ clientId: adaId });
      const bob = new YjsDocumentStore({ clientId: bobId });
      seed(ada);
      create(ada, AXES);
      bob.applyUpdate(ada.encodeState(), RELAY);
      applyCommand(
        ada,
        mustFindCommand('setVariantPreset'),
        {
          componentId: 'main',
          axis: 'state',
          value: 'hover',
          path: 'part',
          override: { fill: [1, 0, 0, 1] },
        },
        ADA,
      );
      applyCommand(
        bob,
        mustFindCommand('setVariantPreset'),
        {
          componentId: 'main',
          axis: 'size',
          value: 'large',
          path: 'part',
          override: { fill: [0, 1, 0, 1] },
        },
        BOB,
      );
      const fromAda = ada.encodeState();
      const fromBob = bob.encodeState();
      ada.applyUpdate(fromBob, RELAY);
      bob.applyUpdate(fromAda, RELAY);
      const expected = {
        'state=rest': {},
        'state=hover': { part: { fill: [1, 0, 0, 1] } },
        'size=small': {},
        'size=large': { part: { fill: [0, 1, 0, 1] } },
      };
      expect(fields(ada).presets).toEqual(expected);
      expect(fields(bob).presets).toEqual(expected);
    },
  );
});
