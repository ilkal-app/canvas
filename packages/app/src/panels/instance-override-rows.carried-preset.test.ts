// The inspector attributes a carried variant preset to the swapped-in child.
import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../engine/__fixtures__/component-board.js';

import { instanceOverrideRows } from './instance-override-rows.js';

const PRESET_FILL = [0, 1, 0, 1];

function instanceOf(store: ReturnType<typeof createComponentBoard>['store']): InstanceObject {
  const object = store.get('inst' as ObjectId);
  if (object?.type !== 'instance') throw new Error('missing card instance');
  return object;
}

function boardWithCarriedPreset(): ReturnType<typeof createComponentBoard>['store'] {
  const { store } = createComponentBoard();
  mustRun(store, 'renameObject', { id: 'dot', name: 'Mark' });
  mustRun(store, 'createObject', {
    object: {
      type: 'frame',
      id: 'check-mark',
      name: 'Mark',
      x: 800,
      y: 100,
      width: 20,
      height: 20,
      clip: false,
      background: null,
    },
  });
  mustRun(store, 'createComponent', {
    ids: ['check-mark'],
    name: 'Check',
    componentId: 'check',
  });
  mustRun(store, 'setVariantAxes', {
    componentId: 'card',
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  mustRun(store, 'setVariantPreset', {
    componentId: 'card',
    axis: 'state',
    value: 'hover',
    path: 'badge-in-card/dot',
    override: { fill: PRESET_FILL, isHidden: true },
  });
  mustRun(store, 'setInstanceVariant', { id: 'inst', variant: { state: 'hover' } });
  return store;
}

describe('instance override rows with a preset carried through a slot swap', () => {
  it('shows carried fields as preset with no own override at the swapped-in child', () => {
    const store = boardWithCarriedPreset();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });

    const rows = instanceOverrideRows(store, instanceOf(store));
    const child = rows.find(({ path }) => path === 'badge-in-card/check-mark');
    // A frame child takes fill since (schema 29), so the carried fill shows too; the
    // filter to the target type's fields is pinned in schema's swap-carries-names tests.
    expect(child).toMatchObject({
      source: { id: 'check-mark', type: 'frame' },
      preset: { isHidden: true, fill: PRESET_FILL },
      override: undefined,
    });
    expect(rows.map(({ path }) => path)).not.toContain('badge-in-card/dot');
  });

  it('keeps an own swapped-child record beside the carried preset', () => {
    const store = boardWithCarriedPreset();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card/check-mark',
      override: { isHidden: false },
    });

    expect(
      instanceOverrideRows(store, instanceOf(store)).find(
        ({ path }) => path === 'badge-in-card/check-mark',
      ),
    ).toMatchObject({
      preset: { isHidden: true },
      override: { isHidden: false },
    });
  });

  it('keeps the stored child’s preset and no swapped-in row before a swap', () => {
    const store = boardWithCarriedPreset();
    const rows = instanceOverrideRows(store, instanceOf(store));

    expect(rows.find(({ path }) => path === 'badge-in-card/dot')).toMatchObject({
      preset: { fill: PRESET_FILL, isHidden: true },
      override: undefined,
    });
    expect(rows.map(({ path }) => path)).not.toContain('badge-in-card/check-mark');
  });
  // A swap that cannot expand shows the stored main's rows and presets.
  it('falls back to the stored child’s preset when the swapped-in main is gone', () => {
    const store = boardWithCarriedPreset();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    mustRun(store, 'deleteObjects', { ids: ['check'] });

    const rows = instanceOverrideRows(store, instanceOf(store));
    expect(rows.find(({ path }) => path === 'badge-in-card/dot')).toMatchObject({
      preset: { fill: PRESET_FILL, isHidden: true },
      override: undefined,
    });
    expect(rows.map(({ path }) => path)).not.toContain('badge-in-card/check-mark');
  });
});
