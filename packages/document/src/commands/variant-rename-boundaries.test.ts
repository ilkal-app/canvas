import { describe, expect, it } from 'vitest';

import type { ComponentObject, InstanceObject, ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { setVariantAxesCommand } from './set-variant-axes.js';

// The boundaries of setVariantAxes's rename checks: a swap of two
// names and a rename onto a fresh name while another goes are not merges, and nested selections
// are found however many mains up they sit.

const CONTEXT = { origin: ADA, now: 0, createId: () => 'x' as ObjectId };

/**
 * A main with a `state` axis and a preset per value, each preset setting its own text.
 *
 * @returns The store and the main's ids.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [{ name: 'state', values: ['rest', 'hover', 'open'] }],
  });
  for (const value of ['rest', 'hover', 'open']) {
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: card.mainId,
      axis: 'state',
      value,
      path: card.noteId,
      override: { text: value },
    });
  }
  return { store, ...card };
}

describe('setVariantAxes rename boundaries', () => {
  it('swaps two values, each preset following its value', () => {
    const { store, mainId, noteId } = seeded();
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'state', values: ['hover', 'rest', 'open'] }],
      renames: {
        values: [
          { axis: 'state', from: 'rest', to: 'hover' },
          { axis: 'state', from: 'hover', to: 'rest' },
        ],
      },
    });
    expect((mustGet(store, mainId) as ComponentObject).variantPresets).toMatchObject({
      'state=hover': { [noteId]: { text: 'rest' } },
      'state=rest': { [noteId]: { text: 'hover' } },
    });
  });

  it('renames a value to a fresh name while another value goes', () => {
    const { store, mainId, noteId } = seeded();
    const outcome = setVariantAxesCommand.validate(
      { ...CONTEXT, board: store },
      {
        componentId: mainId as ObjectId,
        axes: [{ name: 'state', values: ['idle', 'open'] }],
        renames: { values: [{ axis: 'state', from: 'rest', to: 'idle' }] },
      },
    );
    if (!outcome.isValid) throw new Error(JSON.stringify(outcome.errors));
    const main = outcome.plan.objects.find(({ id }) => id === mainId) as ComponentObject;
    expect(main.variantPresets).toEqual({
      'state=idle': { [noteId]: { text: 'rest' } },
      'state=open': { [noteId]: { text: 'open' } },
    });
  });

  it('finds a nested selection two mains up', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [{ name: 'state', values: ['a', 'b'] }],
    });
    placeInstance(store, 'inner', { instanceId: 'nested', x: 2000, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['nested'],
      name: 'Middle',
      componentId: 'middle',
    });
    placeInstance(store, 'middle', { instanceId: 'mid', x: 4000, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['mid'],
      name: 'Outer',
      componentId: 'outer',
    });
    placeInstance(store, 'outer', {
      instanceId: 'top',
      x: 6000,
      y: 0,
      overrides: { 'mid/nested': { variant: { state: 'a' } } },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [{ name: 'state', values: ['c', 'b'] }],
      renames: { values: [{ axis: 'state', from: 'a', to: 'c' }] },
    });
    expect((mustGet(store, 'top') as InstanceObject).overrides).toEqual({
      'mid/nested': { variant: { state: 'c' } },
    });
  });
});
