// Acceptance
import { describe, expect, it } from 'vitest';

import { resolveInstance, type InstanceObject } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  placeInstance,
} from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const AXES = [{ name: 'Size', values: ['base', 'lg'] }];
const ROW = {
  direction: 'row',
  gap: 5,
  padding: { top: 2, right: 2, bottom: 2, left: 2 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
};

/**
 * A 40 × 40 main with a 20 × 20 centred icon and an instance.
 *
 * @returns The fixture store.
 */
function seeded() {
  const store = new YjsDocumentStore();
  createChild(store, newRectangle('background', null, { x: 0, y: 0, width: 40, height: 40 }));
  createChild(store, newRectangle('icon', null, { x: 10, y: 10, width: 20, height: 20 }));
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['background', 'icon'],
    name: 'ToolButton',
    componentId: 'main',
    variantAxes: AXES,
  });
  applyCommand(store, mustFindCommand('setConstraints'), {
    ids: ['icon'],
    x: 'center',
    y: 'center',
  });
  placeInstance(store, 'main', { instanceId: 'copy', variant: { Size: 'base' } });
  return store;
}

/**
 * The root size record for the large value.
 *
 * @param store - The fixture store.
 * @param size - The large variant's box.
 * @param size.width - Its width in world units.
 * @param size.height - Its height in world units.
 */
function large(store: YjsDocumentStore, size: { width: number; height: number }): void {
  applyCommand(store, mustFindCommand('setVariantPreset'), {
    componentId: 'main',
    axis: 'Size',
    value: 'lg',
    path: 'main',
    override: size,
  });
}

describe('variant geometry relayout', () => {
  it('switches 40 × 40 to 48 × 48 and centres the icon in one undo step', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    const before = store.read().objects;
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 48, height: 48 });
    expect(
      resolveInstance(store.read(), mustGet(store, 'copy') as InstanceObject).objects.find(
        ({ id }) => id === 'copy/icon',
      ),
    ).toMatchObject({ x: 14, y: 14, width: 20, height: 20 });
    expect(history.undo()).toBe(true);
    expect(store.read().objects).toEqual(before);
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });

  it('resizing one variant-sized axis fixes only that axis through switches and reset', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    applyCommand(store, mustFindCommand('resizeObjects'), {
      resizes: [{ id: 'copy', to: { width: 60, height: 48 } }],
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 60, height: 48, isWidthFixed: true });
    expect(fieldOf(store, 'copy', 'isHeightFixed')).not.toBe(true);
    applyCommand(store, mustFindCommand('resetInstanceOverrides'), { id: 'copy' });
    expect(fieldOf(store, 'copy', 'isWidthFixed')).toBe(true);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'base' },
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 60, height: 40 });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 60, height: 48 });
  });

  it('creates an instance at its selected variant size', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    placeInstance(store, 'main', { instanceId: 'new-copy', variant: { Size: 'lg' } });
    expect(mustGet(store, 'new-copy')).toMatchObject({ width: 48, height: 48 });
  });

  it('resizes existing instances when a root preset changes in one undo step', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    const before = store.read().objects;
    const history = createHistory(store, ADA.principalId);
    large(store, { width: 52, height: 54 });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 52, height: 54 });
    expect(history.undo()).toBe(true);
    expect(store.read().objects).toEqual(before);
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });

  it('returns to the main size when the selected root record is reset but another preset still sizes the axes', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'base',
      path: 'main',
      override: { width: 44, height: 44 },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 40, height: 40 });
  });

  it('keeps the current size when the last root size on an axis is removed', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
      fields: ['width'],
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 48, height: 48 });
  });

  it('resizes selected instances when setVariantAxes renames a value', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'main',
      axes: [{ name: 'Size', values: ['base', 'large'] }],
      renames: { values: [{ axis: 'Size', from: 'lg', to: 'large' }] },
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 48, height: 48 });
    expect(fieldOf(store, 'copy', 'variant')).toEqual({ Size: 'large' });
  });

  it('takes the remaining default size when setVariantAxes removes a selected sized value', () => {
    const store = seeded();
    large(store, { width: 48, height: 48 });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'base',
      path: 'main',
      override: { width: 44, height: 44 },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'main',
      axes: [{ name: 'Size', values: ['base'] }],
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 44, height: 44 });
  });

  it('lays out a hug row from the root gap and child width, moving a sibling in its parent row', () => {
    const store = new YjsDocumentStore();
    createChild(store, newRectangle('first', null, { x: 0, y: 0, width: 20, height: 20 }));
    createChild(store, newRectangle('last', null, { x: 25, y: 0, width: 20, height: 20 }));
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['first', 'last'],
      name: 'Row',
      componentId: 'main',
      variantAxes: AXES,
    });
    applyCommand(store, mustFindCommand('setAutoLayout'), { ids: ['main'], autoLayout: ROW });
    createChild(store, newFrame('parent', null, { x: 500, y: 0, width: 300, height: 100 }));
    placeInstance(store, 'main', {
      instanceId: 'copy',
      parentId: 'parent',
      variant: { Size: 'base' },
    });
    createChild(store, newRectangle('sibling', 'parent', { x: 100, y: 0, width: 20, height: 20 }));
    applyCommand(store, mustFindCommand('setAutoLayout'), {
      ids: ['parent'],
      autoLayout: { ...ROW, width: 'fixed', height: 'fixed' },
    });
    const before = mustGet(store, 'sibling').x;
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
      override: { autoLayout: { gap: 10, padding: { top: 3, right: 7, bottom: 5, left: 4 } } },
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'first',
      override: { width: 40 },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    expect(mustGet(store, 'copy')).toMatchObject({ width: 81, height: 28 });
    expect(mustGet(store, 'sibling').x).toBeGreaterThan(before);
  });
});
