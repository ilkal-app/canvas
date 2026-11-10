// Acceptance
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import * as documentApi from '../index.js';
import { ADA, BODY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import {
  codesOf,
  fieldOf,
  mustFindCommand,
  overridesOf,
} from './__fixtures__/component-fixtures.js';

/**
 * A card with two axes and one instance selected at the defaults.
 *
 * @returns The store, main, children and instance ids.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [
      { name: 'state', values: ['rest', 'hover'] },
      { name: 'tone', values: ['plain', 'warm'] },
    ],
  });
  const instanceId = placeInstance(store, card.mainId, {
    instanceId: 'chosen',
    variant: { state: 'rest', tone: 'plain' },
  });
  return { store, ...card, instanceId };
}

/**
 * Store a preset at one card path.
 *
 * @param store - The document store.
 * @param componentId - The main id.
 * @param axis - The preset axis.
 * @param value - The preset value.
 * @param path - The child path.
 * @param override - The fields to set.
 */
function preset(
  store: YjsDocumentStore,
  componentId: string,
  axis: string,
  value: string,
  path: string,
  override: Record<string, unknown>,
): void {
  applyCommand(store, mustFindCommand('setVariantPreset'), {
    componentId,
    axis,
    value,
    path,
    override,
  });
}

describe('setInstanceVariant', () => {
  it('is registered and exported with its input schema', () => {
    expect(mustFindCommand('setInstanceVariant').name).toBe('setInstanceVariant');
    expect(documentApi).toHaveProperty('setInstanceVariantCommand');
    expect(documentApi).toHaveProperty('setInstanceVariantInputSchema');
  });

  it('merges partial selections and removes a choice with null', () => {
    const { store, instanceId } = seeded();
    const command = mustFindCommand('setInstanceVariant');
    applyCommand(store, command, { id: instanceId, variant: { state: 'hover' } });
    expect(fieldOf(store, instanceId, 'variant')).toEqual({ state: 'hover', tone: 'plain' });
    applyCommand(store, command, { id: instanceId, variant: { tone: null } });
    expect(fieldOf(store, instanceId, 'variant')).toEqual({ state: 'hover' });
  });

  it('drops own fields touched by either the old or new preset, while keeping unrelated fields and text with runs', () => {
    const { store, mainId, noteId, boxId, captionId, instanceId } = seeded();
    preset(store, mainId, 'state', 'rest', noteId, { color: [1, 0, 0, 1] });
    preset(store, mainId, 'state', 'hover', boxId, { fill: [0, 1, 0, 1] });
    preset(store, mainId, 'tone', 'warm', captionId, { textStyle: { weight: 700 } });
    const set = mustFindCommand('setInstanceOverride');
    applyCommand(store, set, {
      id: instanceId,
      path: noteId,
      override: { color: [0, 0, 1, 1], text: 'Hi' },
    });
    applyCommand(store, set, { id: instanceId, path: boxId, override: { fill: [0, 0, 1, 1] } });
    applyCommand(store, set, {
      id: instanceId,
      path: captionId,
      override: {
        text: 'Yo',
        runs: [{ length: 2, style: BODY }],
        textStyle: { weight: 400, italic: true },
      },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: instanceId,
      variant: { state: 'hover', tone: 'warm' },
    });
    expect(overridesOf(store, instanceId)).toEqual({
      [noteId]: { text: 'Hi' },
      [captionId]: { text: 'Yo', runs: [{ length: 2, style: BODY }], textStyle: { italic: true } },
    });
  });

  it('drops nested variant choices per axis and keeps unrelated axes', () => {
    const store = new YjsDocumentStore();
    const innerLeaf = seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [
        { name: 'state', values: ['rest', 'hover'] },
        { name: 'tone', values: ['plain', 'warm'] },
        { name: 'size', values: ['small', 'large'] },
      ],
    });
    const outer = seedLeafMain(store, 'outer', { x: 1000, y: 0 });
    placeInstance(store, 'inner', { instanceId: 'inner-child', x: 1050, y: 0, parentId: 'outer' });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'outer',
      axes: [{ name: 'mode', values: ['a', 'b'] }],
    });
    preset(store, 'outer', 'mode', 'a', 'inner-child', { variant: { state: 'hover' } });
    preset(store, 'outer', 'mode', 'b', 'inner-child', { variant: { tone: 'warm' } });
    const id = placeInstance(store, 'outer', { instanceId: 'outer-copy' });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id,
      path: 'inner-child',
      override: { variant: { state: 'rest', tone: 'plain', size: 'large' } },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), { id, variant: { mode: 'b' } });
    expect(overridesOf(store, id)).toEqual({ 'inner-child': { variant: { size: 'large' } } });
    expect(innerLeaf).toBe('inner-leaf');
    expect(outer).toBe('outer-leaf');
  });

  it('removes an emptied own record', () => {
    const { store, mainId, boxId, instanceId } = seeded();
    preset(store, mainId, 'state', 'hover', boxId, { fill: [0, 1, 0, 1] });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: boxId,
      override: { fill: [0, 0, 1, 1] },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: instanceId,
      variant: { state: 'hover' },
    });
    expect(overridesOf(store, instanceId)).toEqual({});
  });

  it('refuses non-instances, unknown axes and values, and mains with no axes', () => {
    const { store, mainId, instanceId } = seeded();
    const command = mustFindCommand('setInstanceVariant');
    expect(
      codesOf(expectRejected(store, command, { id: mainId, variant: { state: 'hover' } })),
    ).toEqual(['unsupported-type']);
    for (const variant of [{ absent: 'x' }, { state: 'absent' }]) {
      expect(codesOf(expectRejected(store, command, { id: instanceId, variant }))).toEqual([
        'unknown-variant',
      ]);
    }
    seedLeafMain(store, 'plain', { x: 2000, y: 0 });
    const plain = placeInstance(store, 'plain', { instanceId: 'plain-copy' });
    expect(
      codesOf(expectRejected(store, command, { id: plain, variant: { state: 'hover' } })),
    ).toEqual(['unknown-variant']);
  });

  it('createInstance accepts valid variant choices without switching, and refuses invalid ones', () => {
    const { store, mainId, noteId } = seeded();
    const create = mustFindCommand('createInstance');
    const id = placeInstance(store, mainId, {
      instanceId: 'created',
      variant: { state: 'hover' },
      overrides: { [noteId]: { color: [0, 0, 1, 1] } },
    });
    expect(fieldOf(store, id, 'variant')).toEqual({ state: 'hover' });
    expect(overridesOf(store, id)).toEqual({ [noteId]: { color: [0, 0, 1, 1] } });
    expect(
      codesOf(
        expectRejected(store, create, {
          componentId: mainId,
          x: 0,
          y: 0,
          variant: { state: 'absent' },
        }),
      ),
    ).toEqual(['unknown-variant']);
    expect(
      codesOf(
        expectRejected(store, create, {
          componentId: mainId,
          x: 0,
          y: 0,
          variant: { absent: 'x' },
        }),
      ),
    ).toEqual(['unknown-variant']);
  });

  it('switches the selection and cleans overrides in one undo step', () => {
    const { store, mainId, boxId, instanceId } = seeded();
    preset(store, mainId, 'state', 'hover', boxId, { fill: [0, 1, 0, 1] });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: boxId,
      override: { fill: [0, 0, 1, 1] },
    });
    const before = store.read().objects;
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: instanceId,
      variant: { state: 'hover' },
    });
    expect(history.undo()).toBe(true);
    expect(store.read().objects).toEqual(before);
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });
});
