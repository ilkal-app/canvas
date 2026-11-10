import { describe, expect, it } from 'vitest';

import type { BoardObject, ComponentObject } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

// Copying a main with presets: its preset paths follow the copied children, through
// nested instances too, and a main copied without a given id keeps its presets under the new one.

/**
 * An object as a copy's input: without the fields `createObjects` generates.
 *
 * @param object - The stored object.
 * @returns Its input fields.
 */
function copyInput(object: BoardObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([key]) => !['z', 'createdBy', 'createdAt', 'updatedAt'].includes(key),
    ),
  );
}

describe('copying a main with presets', () => {
  it('remaps a preset path that runs through a nested instance', () => {
    const store = new YjsDocumentStore();
    const leaf = seedLeafMain(store, 'inner', { x: 0, y: 0 });
    placeInstance(store, 'inner', { instanceId: 'nested', x: 2000, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['nested'],
      name: 'Outer',
      componentId: 'outer',
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'outer',
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'outer',
      axis: 'state',
      value: 'hover',
      path: `nested/${leaf}`,
      override: { isHidden: true },
    });
    const { changes } = applyCommand(store, mustFindCommand('createObjects'), {
      objects: ['outer', 'nested'].map((id) => copyInput(mustGet(store, id))),
    });
    const copies = changes.created.map((id) => mustGet(store, id));
    const main = copies.find((object): object is ComponentObject => object.type === 'component');
    const nested = copies.find((object) => object.type === 'instance');
    // The nested instance is copied, the leaf inside its main is not: the path's first segment
    // follows the copy, the last stays the inner main's leaf.
    expect(main?.variantPresets).toEqual({
      'state=rest': {},
      'state=hover': { [`${nested?.id ?? 'missing'}/${leaf}`]: { isHidden: true } },
    });
  });

  it('keeps the presets of a main copied without a given id', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'solo', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'solo',
      axes: [{ name: 'state', values: ['rest'] }],
    });
    const input = copyInput(mustGet(store, 'solo'));
    delete input.id;
    const { changes } = applyCommand(store, mustFindCommand('createObjects'), { objects: [input] });
    const copy = mustGet(store, changes.created[0] ?? 'missing');
    expect(copy).toMatchObject({ type: 'component', variantPresets: { 'state=rest': {} } });
    expect(copy.id).not.toBe('solo');
  });
});
