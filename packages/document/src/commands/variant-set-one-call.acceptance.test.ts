// Acceptance
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newRectangle,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const AXES = [{ name: 'state', values: ['rest', 'hover', 'active'] }];

/**
 * Seeds a rectangle and creates its main with the supplied one-call fields.
 *
 * @param store - The target store.
 * @param fields - Variant fields to pass to createComponent.
 */
function create(store: YjsDocumentStore, fields: Record<string, unknown>): void {
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['part'],
    name: 'Button',
    componentId: 'main',
    ...fields,
  });
}

/**
 * Seeds the selectable part before any history or rejection check.
 *
 * @returns The seeded store.
 */
function seededPart(): YjsDocumentStore {
  const store = new YjsDocumentStore({ clientId: 1 });
  createChild(store, newRectangle('part', null, { x: 20, y: 30, width: 120, height: 60 }));
  return store;
}

/**
 * Requires one error to start at the supplied preset and path.
 *
 * @param errors - Command refusals.
 * @param code - Required command error code.
 * @param prefix - Required start of the error path.
 */
function errorAt(
  errors: readonly { code: string; path: readonly (string | number)[] }[],
  code: string,
  prefix: readonly (string | number)[],
): void {
  expect(
    errors.some(
      (error) => error.code === code && prefix.every((part, i) => error.path[i] === part),
    ),
  ).toBe(true);
}

describe('createComponent variantPresets', () => {
  it('stores given records exactly, including an explicit empty entry and empty omitted values', () => {
    const store = seededPart();
    create(store, {
      variantAxes: AXES,
      variantPresets: {
        'state=rest': {},
        'state=hover': { part: { fill: [0, 1, 0, 1] } },
      },
    });
    expect(fieldOf(store, 'main', 'variantAxes')).toEqual(AXES);
    expect(fieldOf(store, 'main', 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { part: { fill: [0, 1, 0, 1] } },
      'state=active': {},
    });
  });

  it('creates the main and populated presets in one undo step', () => {
    const store = seededPart();
    const history = createHistory(store, ADA.principalId);
    create(store, {
      variantAxes: AXES,
      variantPresets: { 'state=hover': { part: { fill: [0, 1, 0, 1] } } },
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(store.get('part' as never)?.parentId).toBeNull();
    expect(store.get('main' as never)).toMatchObject({ retired: true });
    history.destroy();
  });

  it('refuses presets without axes and writes nothing', () => {
    const store = seededPart();
    const errors = expectRejected(store, mustFindCommand('createComponent'), {
      ids: ['part'],
      name: 'Button',
      componentId: 'main',
      variantPresets: { 'state=hover': { part: { fill: [0, 1, 0, 1] } } },
    });
    errorAt(errors, 'invalid-input', ['variantPresets']);
    expect(store.get('main' as never)).toBeUndefined();
  });

  it.each(['not-a-key', 'state=missing', 'missing=hover'])(
    'refuses unknown preset key %s without a write',
    (key) => {
      const store = seededPart();
      const errors = expectRejected(store, mustFindCommand('createComponent'), {
        ids: ['part'],
        name: 'Button',
        componentId: 'main',
        variantAxes: AXES,
        variantPresets: { [key]: {} },
      });
      errorAt(errors, 'unknown-variant', ['variantPresets', key]);
      expect(store.get('main' as never)).toBeUndefined();
    },
  );

  it.each([
    ['outside', { fill: [0, 1, 0, 1] }, 'invalid-override-path'],
    ['part', { color: [0, 1, 0, 1] }, 'invalid-override'],
  ])('refuses bad record at %s without a write', (path, override, code) => {
    const store = seededPart();
    const errors = expectRejected(store, mustFindCommand('createComponent'), {
      ids: ['part'],
      name: 'Button',
      componentId: 'main',
      variantAxes: AXES,
      variantPresets: { 'state=hover': { [path]: override } },
    });
    errorAt(errors, code, ['variantPresets', 'state=hover', path]);
    expect(store.get('main' as never)).toBeUndefined();
  });

  it('accepts a nested child path through a nested instance', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    placeInstance(store, 'inner', { instanceId: 'slot', x: 300, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['slot'],
      name: 'Outer',
      componentId: 'outer',
      variantAxes: AXES,
      variantPresets: { 'state=hover': { 'slot/inner-leaf': { text: 'Hover' } } },
    });
    expect(fieldOf(store, 'outer', 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { 'slot/inner-leaf': { text: 'Hover' } },
      'state=active': {},
    });
  });

  it('refuses a nested path that does not address a child', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    placeInstance(store, 'inner', { instanceId: 'slot', x: 300, y: 0 });
    const path = 'slot/missing';
    const errors = expectRejected(store, mustFindCommand('createComponent'), {
      ids: ['slot'],
      name: 'Outer',
      componentId: 'outer',
      variantAxes: AXES,
      variantPresets: { 'state=hover': { [path]: { text: 'Hover' } } },
    });
    errorAt(errors, 'invalid-override-path', ['variantPresets', 'state=hover', path]);
    expect(store.get('outer' as never)).toBeUndefined();
  });
});

describe('setVariantAxes variantPresets', () => {
  it('adds a new value and its preset in one call', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'kind', values: ['solid', 'ghost'] }],
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'kind', values: ['solid', 'ghost', 'outline'] }],
      variantPresets: { 'kind=outline': { [boxId]: { fill: [0, 0, 1, 1] } } },
    });
    expect(fieldOf(store, mainId, 'variantPresets')).toEqual({
      'kind=solid': {},
      'kind=ghost': {},
      'kind=outline': { [boxId]: { fill: [0, 0, 1, 1] } },
    });
  });

  it('merges fields into an existing path record and keeps other paths', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), { componentId: mainId, axes: AXES });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Before', textStyle: { fontSize: 20 } },
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: boxId,
      override: { fill: [0, 0, 1, 1] },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: AXES,
      variantPresets: { 'state=hover': { [noteId]: { textStyle: { weight: 700 } } } },
    });
    expect(fieldOf(store, mainId, 'variantPresets')).toMatchObject({
      'state=hover': {
        [noteId]: { text: 'Before', textStyle: { fontSize: 20, weight: 700 } },
        [boxId]: { fill: [0, 0, 1, 1] },
      },
    });
  });

  it('carries a renamed preset then merges records keyed by its new name', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId, noteId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), { componentId: mainId, axes: AXES });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Before' },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'mode', values: ['rest', 'over', 'active'] }],
      renames: {
        axes: [{ from: 'state', to: 'mode' }],
        values: [{ axis: 'mode', from: 'hover', to: 'over' }],
      },
      variantPresets: { 'mode=over': { [noteId]: { color: [0, 1, 0, 1] } } },
    });
    expect(fieldOf(store, mainId, 'variantPresets')).toEqual({
      'mode=rest': {},
      'mode=over': { [noteId]: { text: 'Before', color: [0, 1, 0, 1] } },
      'mode=active': {},
    });
  });

  it('refuses presets with null axes without a write', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId, noteId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), { componentId: mainId, axes: AXES });
    const errors = expectRejected(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: null,
      variantPresets: { 'state=hover': { [noteId]: { text: 'Hover' } } },
    });
    errorAt(errors, 'invalid-input', ['variantPresets']);
    expect(fieldOf(store, mainId, 'variantAxes')).toEqual(AXES);
  });

  it.each([
    ['bad', {}, 'unknown-variant', ['variantPresets', 'bad']],
    ['state=missing', {}, 'unknown-variant', ['variantPresets', 'state=missing']],
    [
      'state=hover',
      { outside: { text: 'No' } },
      'invalid-override-path',
      ['variantPresets', 'state=hover', 'outside'],
    ],
    [
      'state=hover',
      { 'card-box': { color: [0, 1, 0, 1] } },
      'invalid-override',
      ['variantPresets', 'state=hover', 'card-box'],
    ],
  ])('refuses invalid supplied preset %s without writing', (key, record, code, path) => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId } = seedMainWithChildren(store);
    const errors = expectRejected(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: AXES,
      variantPresets: { [key]: record },
    });
    errorAt(errors, code, path);
    expect(fieldOf(store, mainId, 'variantAxes')).toBeUndefined();
  });

  it('undoes the axes and supplied preset as one step', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const { mainId, noteId } = seedMainWithChildren(store);
    const before = store.read().objects;
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: AXES,
      variantPresets: { 'state=hover': { [noteId]: { text: 'Hover' } } },
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(store.read().objects).toEqual(before);
    history.destroy();
  });
});
