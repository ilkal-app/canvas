// Acceptance
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, resolveInstance, type InstanceObject } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  newText,
  placeInstance,
  seedLeafMain,
} from './__fixtures__/component-boards.js';
import { codesOf, fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const AXES = [{ name: 'Size', values: ['base', 'lg'] }];

/**
 * A small main with a centred icon slot and a selected instance.
 *
 * @returns The fixture store and instance id.
 */
function button() {
  const store = new YjsDocumentStore();
  createChild(store, newRectangle('background', null, { x: 0, y: 0, width: 40, height: 40 }));
  createChild(store, newRectangle('icon', null, { x: 10, y: 10, width: 20, height: 20 }));
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['background', 'icon'],
    name: 'ToolButton',
    componentId: 'main',
    variantAxes: AXES,
  });
  const instanceId = placeInstance(store, 'main', {
    instanceId: 'copy',
    variant: { Size: 'base' },
  });
  return { store, instanceId };
}

/**
 * The one icon drawn by an instance.
 *
 * @param store - The fixture store.
 * @returns The resolved icon, when present.
 */
function icon(store: YjsDocumentStore): unknown {
  const instance = mustGet(store, 'copy') as InstanceObject;
  return resolveInstance(store.read(), instance).objects.find(({ id }) => id === 'copy/icon');
}

/**
 * Set a field record in the large preset.
 *
 * @param store - The fixture store.
 * @param path - The source object path.
 * @param override - Its replacement fields.
 */
function setLarge(store: YjsDocumentStore, path: string, override: Record<string, unknown>): void {
  applyCommand(store, mustFindCommand('setVariantPreset'), {
    componentId: 'main',
    axis: 'Size',
    value: 'lg',
    path,
    override,
  });
}

describe('preset geometry commands', () => {
  it('switches the ToolButton icon geometry back and forth with one undo step per switch', () => {
    const { store } = button();
    setLarge(store, 'icon', { x: 8, y: 8, width: 24, height: 24 });
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    expect(icon(store)).toMatchObject({ x: 8, y: 8, width: 24, height: 24 });
    expect(history.undo()).toBe(true);
    expect(icon(store)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
    expect(history.canUndo()).toBe(false);
    history.destroy();
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'lg' },
    });
    const back = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'copy',
      variant: { Size: 'base' },
    });
    expect(icon(store)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
    expect(back.undo()).toBe(true);
    expect(icon(store)).toMatchObject({ x: 8, y: 8, width: 24, height: 24 });
    expect(back.canUndo()).toBe(false);
    back.destroy();
  });

  it('accepts child geometry but refuses unsupported child geometry and bounds', () => {
    const { store } = button();
    setLarge(store, 'icon', { x: 8, y: 8, width: 24, height: 24 });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({
      'Size=lg': { icon: { x: 8, y: 8, width: 24, height: 24 } },
    });
    const target = { componentId: 'main', axis: 'Size', value: 'lg', path: 'icon' };
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          ...target,
          override: { width: -1 },
        }),
      ),
    ).toEqual(['invalid-input']);
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          ...target,
          override: { width: BOARD_BOUND + 1 },
        }),
      ),
    ).toEqual(['invalid-input']);
  });

  it('accepts only width, height and eligible autoLayout on a preset root', () => {
    const { store } = button();
    setLarge(store, 'main', { width: 48, height: 48 });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({
      'Size=lg': { main: { width: 48, height: 48 } },
    });
    for (const override of [
      { x: 1 },
      { isHidden: true },
      { fill: [1, 0, 0, 1] },
      { text: 'No' },
      { autoLayout: { gap: 16 } },
    ]) {
      expect(
        codesOf(
          expectRejected(store, mustFindCommand('setVariantPreset'), {
            componentId: 'main',
            axis: 'Size',
            value: 'lg',
            path: 'main',
            override,
          }),
        ),
      ).toEqual(['invalid-override']);
    }
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setInstanceOverride'), {
          id: 'copy',
          path: 'main',
          override: { width: 60 },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });

  it('clears root fields or its entire record with resetVariantPreset', () => {
    const { store } = button();
    setLarge(store, 'main', { width: 48, height: 50 });
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
      fields: ['width'],
    });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({
      'Size=lg': { main: { height: 50 } },
    });
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
    });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({ 'Size=lg': {} });
  });

  it('takes root sizes in both one-call preset commands', () => {
    const store = new YjsDocumentStore();
    createChild(store, newRectangle('part', null, { x: 0, y: 0, width: 40, height: 40 }));
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['part'],
      name: 'Button',
      componentId: 'main',
      variantAxes: AXES,
      variantPresets: { 'Size=lg': { main: { width: 48, height: 48 } } },
    });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({
      'Size=lg': { main: { width: 48, height: 48 } },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'main',
      axes: AXES,
      variantPresets: { 'Size=lg': { main: { width: 50 } } },
    });
    expect(fieldOf(store, 'main', 'variantPresets')).toMatchObject({
      'Size=lg': { main: { width: 50, height: 48 } },
    });
  });

  it('refuses a group or path width and autoLayout on a frame without layout', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), { componentId: 'main', axes: AXES });
    createChild(store, { type: 'group', id: 'group', parentId: 'main', x: 0, y: 0 });
    createChild(store, {
      type: 'path',
      id: 'path',
      parentId: 'main',
      x: 0,
      y: 0,
      vertices: [{ id: 'v1', x: 0, y: 0, mirror: 'none' }],
      segments: [],
      stroke: null,
      fill: null,
    });
    createChild(store, newFrame('frame', 'main', { x: 0, y: 0, width: 40, height: 40 }));
    for (const path of ['group', 'path']) {
      expect(
        codesOf(
          expectRejected(store, mustFindCommand('setVariantPreset'), {
            componentId: 'main',
            axis: 'Size',
            value: 'lg',
            path,
            override: { width: 30 },
          }),
        ),
      ).toEqual(['invalid-override']);
    }
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          componentId: 'main',
          axis: 'Size',
          value: 'lg',
          path: 'frame',
          override: { autoLayout: { gap: 16 } },
        }),
      ),
    ).toEqual(['invalid-override']);
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          componentId: 'main',
          axis: 'Size',
          value: 'lg',
          path: 'main',
          override: { autoLayout: { gap: 16 } },
        }),
      ),
    ).toEqual(['invalid-override']);
  });

  it('switches Avatar visibility with one initials layer and one agent icon layer', () => {
    const store = new YjsDocumentStore();
    createChild(store, newText('initials', null, { x: 0, y: 0, width: 40, height: 40 }));
    createChild(store, newRectangle('agent', null, { x: 0, y: 0, width: 40, height: 40 }));
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['initials', 'agent'],
      name: 'Avatar',
      componentId: 'main',
      variantAxes: [{ name: 'Kind', values: ['person', 'agent'] }],
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Kind',
      value: 'person',
      path: 'agent',
      override: { isHidden: true },
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Kind',
      value: 'agent',
      path: 'initials',
      override: { isHidden: true },
    });
    placeInstance(store, 'main', { instanceId: 'avatar', variant: { Kind: 'person' } });
    const visible = () =>
      resolveInstance(store.read(), mustGet(store, 'avatar') as InstanceObject).objects.map(
        ({ id }) => id,
      );
    expect(visible()).toEqual(['avatar/initials']);
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'avatar',
      variant: { Kind: 'agent' },
    });
    expect(visible()).toEqual(['avatar/agent']);
  });
});
