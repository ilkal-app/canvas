// Acceptance
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import * as documentApi from '../index.js';
import { ADA, BOB, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { codesOf, fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';
import { isCommandErrorCode } from './command-error.js';
import { deleteObjectsCommand } from './delete-objects.js';

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/**
 * Read one stored main field after requiring a component.
 *
 * @param store - The document store.
 * @param id - The main id.
 * @param field - The field name.
 * @returns The stored field.
 */
function mainField(store: YjsDocumentStore, id: string, field: string): unknown {
  expect(mustGet(store, id).type).toBe('component');
  return fieldOf(store, id, field);
}

describe('setVariantAxes', () => {
  it('is registered and exported with its input schema', () => {
    expect(mustFindCommand('setVariantAxes').name).toBe('setVariantAxes');
    expect(documentApi).toHaveProperty('setVariantAxesCommand');
    expect(documentApi).toHaveProperty('setVariantAxesInputSchema');
    expect(isCommandErrorCode('unknown-variant')).toBe(true);
  });

  it('replaces axes, preserving presets for retained values, and null removes axes and presets', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const axes = mustFindCommand('setVariantAxes');
    applyCommand(store, axes, { componentId: mainId, axes: AXES });
    expect(mainField(store, mainId, 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': {},
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Hover' },
    });
    applyCommand(store, axes, {
      componentId: mainId,
      axes: [...AXES, { name: 'size', values: ['small'] }],
    });
    expect(mainField(store, mainId, 'variantAxes')).toEqual([
      ...AXES,
      { name: 'size', values: ['small'] },
    ]);
    expect(mainField(store, mainId, 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { [noteId]: { text: 'Hover' } },
      'size=small': {},
    });
    applyCommand(store, axes, { componentId: mainId, axes: null });
    expect(mainField(store, mainId, 'variantAxes')).toBeUndefined();
    expect(mainField(store, mainId, 'variantPresets')).toBeUndefined();
  });

  it('renames preset keys and selections of live and retired instances, including nested override records', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    seedLeafMain(store, 'outer', { x: 1000, y: 0 });
    const axes = mustFindCommand('setVariantAxes');
    applyCommand(store, axes, { componentId: mainId, axes: AXES });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Hover' },
    });
    placeInstance(store, mainId, {
      instanceId: 'live',
      x: 1200,
      y: 0,
      variant: { state: 'hover' },
    });
    placeInstance(store, mainId, {
      instanceId: 'nested',
      x: 1050,
      y: 0,
      parentId: 'outer',
      variant: { state: 'hover' },
    });
    placeInstance(store, 'outer', {
      instanceId: 'outer-copy',
      x: 2000,
      y: 0,
      overrides: { nested: { variant: { state: 'hover' } } },
    });
    applyCommand(store, axes, {
      componentId: mainId,
      axes: [{ name: 'mode', values: ['rest', 'over'] }],
      renames: {
        axes: [{ from: 'state', to: 'mode' }],
        values: [{ axis: 'mode', from: 'hover', to: 'over' }],
      },
    });
    expect(mainField(store, mainId, 'variantPresets')).toEqual({
      'mode=rest': {},
      'mode=over': { [noteId]: { text: 'Hover' } },
    });
    expect(fieldOf(store, 'live', 'variant')).toEqual({ mode: 'over' });
    expect(fieldOf(store, 'nested', 'variant')).toEqual({ mode: 'over' });
    expect(fieldOf(store, 'outer-copy', 'overrides')).toMatchObject({
      nested: { variant: { mode: 'over' } },
    });
  });

  it('rewrites a late stored instance of a retired main', () => {
    let mainId = '';
    const [ada, bob] = createComponentPair(1, 2, (store) => {
      mainId = seedMainWithChildren(store).mainId;
      applyCommand(store, mustFindCommand('setVariantAxes'), { componentId: mainId, axes: AXES });
    });
    applyCommand(ada, deleteObjectsCommand, { ids: [mainId] });
    placeInstance(bob, mainId, { instanceId: 'late', variant: { state: 'hover' } }, BOB);
    exchange(ada, bob);
    expect(fieldOf(ada, mainId, 'retired')).toBe(true);
    applyCommand(ada, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'mode', values: ['rest', 'hover'] }],
      renames: { axes: [{ from: 'state', to: 'mode' }] },
    });
    expect(fieldOf(ada, 'late', 'variant')).toEqual({ mode: 'hover' });
  });

  it('removes presets for removed axes or values but keeps stale selections for default fallback', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const axes = mustFindCommand('setVariantAxes');
    applyCommand(store, axes, {
      componentId: mainId,
      axes: [...AXES, { name: 'tone', values: ['plain', 'warm'] }],
    });
    for (const [axis, value] of [
      ['state', 'hover'],
      ['tone', 'warm'],
    ]) {
      applyCommand(store, mustFindCommand('setVariantPreset'), {
        componentId: mainId,
        axis,
        value,
        path: noteId,
        override: { text: value },
      });
    }
    placeInstance(store, mainId, {
      instanceId: 'chosen',
      variant: { state: 'hover', tone: 'warm' },
    });
    applyCommand(store, axes, { componentId: mainId, axes: [{ name: 'state', values: ['rest'] }] });
    expect(mainField(store, mainId, 'variantPresets')).toEqual({ 'state=rest': {} });
    expect(fieldOf(store, 'chosen', 'variant')).toEqual({ state: 'hover', tone: 'warm' });
  });

  it('refuses non-mains, invalid renames and schema-invalid names, limits and duplicates without writes', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const command = mustFindCommand('setVariantAxes');
    applyCommand(store, command, { componentId: mainId, axes: AXES });
    expect(codesOf(expectRejected(store, command, { componentId: noteId, axes: AXES }))).toEqual([
      'unsupported-type',
    ]);
    for (const { axes, renames } of [
      {
        axes: [{ name: 'mode', values: ['rest', 'over'] }],
        renames: { axes: [{ from: 'absent', to: 'mode' }] },
      },
      {
        axes: [{ name: 'mode', values: ['rest', 'over'] }],
        renames: { axes: [{ from: 'state', to: 'absent' }] },
      },
      {
        axes: [{ name: 'state', values: ['rest', 'over'] }],
        renames: { values: [{ axis: 'state', from: 'absent', to: 'over' }] },
      },
      {
        axes: [{ name: 'state', values: ['rest', 'over'] }],
        renames: { values: [{ axis: 'state', from: 'hover', to: 'absent' }] },
      },
    ]) {
      const errors = expectRejected(store, command, {
        componentId: mainId,
        axes,
        renames,
      });
      expect(codesOf(errors)).toEqual(['unknown-variant']);
      expect(errors[0]?.path[0]).toBe('renames');
    }
    for (const invalid of [
      [{ name: ' state', values: ['rest'] }],
      [{ name: 'state=x', values: ['rest'] }],
      [{ name: 'state', values: ['rest', 'rest'] }],
      [
        { name: 'state', values: ['rest'] },
        { name: 'state', values: ['hover'] },
      ],
      Array.from({ length: 9 }, (unused, index) => ({
        name: `axis${String(index)}`,
        values: ['one'],
      })),
      [
        {
          name: 'state',
          values: Array.from({ length: 33 }, (unused, index) => `value${String(index)}`),
        },
      ],
    ])
      expect(
        codesOf(expectRejected(store, command, { componentId: mainId, axes: invalid })),
      ).toContain('invalid-input');
  });

  it('undoes an axes edit and its preset and selection renames as one step', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const command = mustFindCommand('setVariantAxes');
    applyCommand(store, command, { componentId: mainId, axes: AXES });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Hover' },
    });
    placeInstance(store, mainId, { instanceId: 'chosen', variant: { state: 'hover' } });
    const before = store.read().objects;
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, command, {
      componentId: mainId,
      axes: [{ name: 'mode', values: ['rest', 'hover'] }],
      renames: { axes: [{ from: 'state', to: 'mode' }] },
    });
    expect(history.undo()).toBe(true);
    expect(store.read().objects).toEqual(before);
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });
});
