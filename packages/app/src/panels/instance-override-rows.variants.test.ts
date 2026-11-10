import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../engine/__fixtures__/component-board.js';

import { instanceOverrideRows, mainOverrideRows } from './instance-override-rows.js';

// The rows with variants: an instance's rows carry what its chosen presets set,
// beside its own records; a main's rows can be read against one preset's records.

/**
 * The card's main with a `state` axis whose `hover` preset retitles and hides the note.
 *
 * @returns The store.
 */
function variantBoard() {
  const { store } = createComponentBoard();
  mustRun(store, 'setVariantAxes', {
    componentId: 'card',
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  const hover = { componentId: 'card', axis: 'state', value: 'hover' };
  mustRun(store, 'setVariantPreset', { ...hover, path: 'title', override: { text: 'Hover' } });
  mustRun(store, 'setVariantPreset', { ...hover, path: 'note', override: { isHidden: true } });
  return store;
}

/**
 * The stored card instance.
 *
 * @param store - The board.
 * @param store.get - Its reader.
 * @returns It.
 * @throws {Error} When it is not an instance.
 */
function instance(store: { get(id: ObjectId): unknown }): InstanceObject {
  const object = store.get('inst' as ObjectId) as InstanceObject | undefined;
  if (object?.type !== 'instance') throw new Error('no instance');
  return object;
}

describe('override rows with variants', () => {
  it('carries the chosen presets under the own records', () => {
    const store = variantBoard();
    mustRun(store, 'setInstanceOverride', { id: 'inst', path: 'title', override: { text: 'Own' } });
    mustRun(store, 'setInstanceVariant', { id: 'inst', variant: { state: 'hover' } });
    const rows = instanceOverrideRows(store, instance(store));
    // The switch keeps own text, so the title has both; the note only the preset.
    expect(rows.find(({ path }) => path === 'title')).toMatchObject({
      override: { text: 'Own' },
      preset: { text: 'Hover' },
    });
    expect(rows.find(({ path }) => path === 'note')).toMatchObject({
      override: undefined,
      preset: { isHidden: true },
    });
  });

  it('carries no preset for an instance on the default value', () => {
    const store = variantBoard();
    const rows = instanceOverrideRows(store, instance(store));
    expect(rows.every((row) => row.preset === undefined)).toBe(true);
  });

  it('reads a main’s rows against one preset’s records', () => {
    const store = variantBoard();
    const main = store.get('card' as ObjectId);
    if (main?.type !== 'component') throw new Error('no main');
    const rows = mainOverrideRows(store, main.id, main.variantPresets?.['state=hover'] ?? {});
    expect(rows.find(({ path }) => path === 'title')).toMatchObject({
      override: { text: 'Hover' },
    });
    expect(rows.find(({ path }) => path === 'body')?.override).toBeUndefined();
  });

  it('carries a nested instance’s own presets, at the value the outer records choose', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setVariantAxes', {
      componentId: 'badge',
      axes: [{ name: 'tone', values: ['plain', 'warm'] }],
    });
    const tone = { componentId: 'badge', axis: 'tone' };
    mustRun(store, 'setVariantPreset', {
      ...tone,
      value: 'plain',
      path: 'dot',
      override: { fill: [0, 0, 1, 1] },
    });
    mustRun(store, 'setVariantPreset', {
      ...tone,
      value: 'warm',
      path: 'dot',
      override: { fill: [1, 0.5, 0, 1] },
    });
    const dot = () =>
      instanceOverrideRows(store, instance(store)).find(({ path }) => path === 'badge-in-card/dot');
    // The nested badge shows its default value's preset.
    expect(dot()).toMatchObject({ preset: { fill: [0, 0, 1, 1] } });
    // The outer instance chooses `warm` for it.
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { variant: { tone: 'warm' } },
    });
    expect(dot()).toMatchObject({ preset: { fill: [1, 0.5, 0, 1] } });
    // The outer main's own preset at that path wins over the nested one.
    mustRun(store, 'setVariantAxes', {
      componentId: 'card',
      axes: [{ name: 'state', values: ['rest'] }],
    });
    mustRun(store, 'setVariantPreset', {
      componentId: 'card',
      axis: 'state',
      value: 'rest',
      path: 'badge-in-card/dot',
      override: { fill: [0, 1, 0, 1] },
    });
    expect(dot()).toMatchObject({ preset: { fill: [0, 1, 0, 1] } });
  });

  it('lists nothing for a main that is missing', () => {
    const { store } = createComponentBoard();
    expect(mainOverrideRows(store, 'gone' as ObjectId, {})).toEqual([]);
  });
});
