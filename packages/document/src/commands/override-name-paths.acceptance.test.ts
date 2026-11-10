// Independent acceptance: names are input paths; stored records remain keyed by ids.
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  placeInstance,
} from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const GREEN = [0, 1, 0, 1] as const;
const AXES = [{ name: 'state', values: ['rest', 'hover'] }];
const PRESET = { componentId: 'tool-main', axis: 'state', value: 'hover' };
const NAME_PATH = 'icon/icon/select/Vector';
const ID_PATH = 'icon-slot/icon-vector';

/**
 * Builds the two mains and outer instance through public commands.
 *
 * @returns The store and outer instance id.
 */
function toolButton() {
  const store = new YjsDocumentStore();
  createChild(store, newRectangle('icon-vector', null, { x: 0, y: 0, width: 24, height: 24 }));
  applyCommand(store, mustFindCommand('renameObject'), { id: 'icon-vector', name: 'Vector' });
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['icon-vector'],
    name: 'icon/select',
    componentId: 'icon-main',
  });
  createChild(store, newFrame('icon-frame', null, { x: 200, y: 0, width: 80, height: 80 }));
  applyCommand(store, mustFindCommand('renameObject'), { id: 'icon-frame', name: 'icon' });
  placeInstance(store, 'icon-main', {
    instanceId: 'icon-slot',
    parentId: 'icon-frame',
    x: 210,
    y: 10,
  });
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['icon-frame'],
    name: 'ToolButton',
    componentId: 'tool-main',
    variantAxes: AXES,
  });
  const instanceId = placeInstance(store, 'tool-main', {
    instanceId: 'tool-instance',
    x: 500,
    y: 0,
  });
  return { store, instanceId };
}

/**
 * Reads the stored instance override map.
 *
 * @param store - The document store.
 * @returns The stored override map.
 * @throws {Error} When the instance is missing.
 */
function overrides(store: YjsDocumentStore): Record<string, unknown> {
  const instance = mustGet(store, 'tool-instance');
  if (instance.type !== 'instance') throw new Error('ToolButton instance missing');
  return instance.overrides;
}

/**
 * Reads one stored preset.
 *
 * @param store - The document store.
 * @returns The hover preset records.
 * @throws {Error} When the main is missing.
 */
function hover(store: YjsDocumentStore): Record<string, unknown> {
  const main = mustGet(store, 'tool-main');
  if (main.type !== 'component') throw new Error('ToolButton main missing');
  return main.variantPresets?.['state=hover'] ?? {};
}

describe('override paths by child name', () => {
  it('walks a frame, inherited instance name containing slash, and Vector; stores only slot and target ids', () => {
    const { store, instanceId } = toolButton();
    const result = applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: NAME_PATH,
      override: { fill: GREEN },
    });
    expect(result.result).toEqual({ path: ID_PATH });
    expect(overrides(store)).toEqual({ [ID_PATH]: { fill: GREEN } });
  });

  it('uses a nested instance own name and accepts a mixed id/name path', () => {
    const { store, instanceId } = toolButton();
    applyCommand(store, mustFindCommand('renameObject'), { id: 'icon-slot', name: 'chosen icon' });
    const set = mustFindCommand('setInstanceOverride');
    applyCommand(store, set, {
      id: instanceId,
      path: 'icon/chosen icon/Vector',
      override: { fill: GREEN },
    });
    applyCommand(store, set, {
      id: instanceId,
      path: 'icon-frame/chosen icon/icon-vector',
      override: { isHidden: true },
    });
    expect(overrides(store)).toEqual({ [ID_PATH]: { fill: GREEN, isHidden: true } });
  });

  it('keeps an existing all-id path authoritative', () => {
    const { store, instanceId } = toolButton();
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: ID_PATH,
      override: { fill: GREEN },
    });
    expect(overrides(store)).toEqual({ [ID_PATH]: { fill: GREEN } });
  });

  it('resets by name and reports the id path', () => {
    const { store, instanceId } = toolButton();
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: ID_PATH,
      override: { fill: GREEN },
    });
    const result = applyCommand(store, mustFindCommand('resetInstanceOverrides'), {
      id: instanceId,
      path: NAME_PATH,
    });
    expect(result.result).toEqual({ paths: [ID_PATH] });
    expect(overrides(store)).toEqual({});
  });

  it('sets and resets a variant preset by name while storing and reporting ids', () => {
    const { store } = toolButton();
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      ...PRESET,
      path: NAME_PATH,
      override: { fill: GREEN },
    });
    expect(hover(store)).toEqual({ [ID_PATH]: { fill: GREEN } });
    const reset = applyCommand(store, mustFindCommand('resetVariantPreset'), {
      ...PRESET,
      path: NAME_PATH,
    });
    expect(reset.result).toEqual({ paths: [ID_PATH] });
    expect(hover(store)).toEqual({});
  });

  it('addresses the preset root by the main name', () => {
    const { store } = toolButton();
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      ...PRESET,
      path: 'ToolButton',
      override: { width: 140 },
    });
    expect(hover(store)).toEqual({ 'tool-main': { width: 140 } });
  });

  it('resolves one-call createInstance override keys and one-call setVariantAxes preset keys', () => {
    const { store } = toolButton();
    applyCommand(store, mustFindCommand('createInstance'), {
      componentId: 'tool-main',
      instanceId: 'second-tool',
      x: 700,
      y: 0,
      overrides: { [NAME_PATH]: { fill: GREEN } },
    });
    const second = mustGet(store, 'second-tool');
    expect(second.type === 'instance' ? second.overrides : undefined).toEqual({
      [ID_PATH]: { fill: GREEN },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'tool-main',
      axes: AXES,
      variantPresets: { 'state=hover': { [NAME_PATH]: { fill: GREEN } } },
    });
    expect(hover(store)).toEqual({ [ID_PATH]: { fill: GREEN } });
  });

  it('resolves one-call createComponent preset keys before storing the new main', () => {
    const store = new YjsDocumentStore();
    createChild(store, newRectangle('part', null, { x: 0, y: 0, width: 30, height: 30 }));
    applyCommand(store, mustFindCommand('renameObject'), { id: 'part', name: 'Vector' });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['part'],
      name: 'Icon',
      componentId: 'icon',
      variantAxes: AXES,
      variantPresets: { 'state=hover': { Vector: { fill: GREEN }, Icon: { width: 50 } } },
    });
    const main = mustGet(store, 'icon');
    expect(main.type === 'component' ? main.variantPresets?.['state=hover'] : undefined).toEqual({
      part: { fill: GREEN },
      icon: { width: 50 },
    });
  });

  it('refuses a missing child name with invalid-override-path and no write', () => {
    const { store, instanceId } = toolButton();
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setInstanceOverride'), {
          id: instanceId,
          path: 'icon/icon/select/Missing',
          override: { fill: GREEN },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });

  it('refuses two sibling children with the same name and names the ambiguous step', () => {
    const store = new YjsDocumentStore();
    for (const [id, x] of [
      ['first', 0],
      ['second', 50],
    ] as const) {
      createChild(store, newRectangle(id, null, { x, y: 0, width: 30, height: 30 }));
      applyCommand(store, mustFindCommand('renameObject'), { id, name: 'Vector' });
    }
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['first', 'second'],
      name: 'Icon',
      componentId: 'icon-main',
    });
    const instanceId = placeInstance(store, 'icon-main', { instanceId: 'icon-instance', x: 300 });
    const errors = expectRejected(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'Vector',
      override: { fill: GREEN },
    });
    expect(codesOf(errors)).toEqual(['ambiguous-override-path']);
    expect(errors[0]?.message).toContain('Vector');
  });

  it('refuses two complete readings caused by a slash inside a child name', () => {
    const store = new YjsDocumentStore();
    createChild(store, newFrame('container', null, { x: 0, y: 0, width: 100, height: 100 }));
    applyCommand(store, mustFindCommand('renameObject'), { id: 'container', name: 'a' });
    createChild(store, newRectangle('nested', 'container', { x: 0, y: 0, width: 30, height: 30 }));
    applyCommand(store, mustFindCommand('renameObject'), { id: 'nested', name: 'b' });
    createChild(store, newRectangle('direct', null, { x: 150, y: 0, width: 30, height: 30 }));
    applyCommand(store, mustFindCommand('renameObject'), { id: 'direct', name: 'a/b' });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['container', 'direct'],
      name: 'Ambiguous',
      componentId: 'ambiguous-main',
    });
    const instanceId = placeInstance(store, 'ambiguous-main', {
      instanceId: 'ambiguous-instance',
      x: 400,
    });
    const errors = expectRejected(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'a/b',
      override: { fill: GREEN },
    });
    expect(codesOf(errors)).toEqual(['ambiguous-override-path']);
    expect(errors[0]?.message).toContain('a/b');
  });

  it('makes a name-path override one undo step', () => {
    const { store, instanceId } = toolButton();
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: NAME_PATH,
      override: { fill: GREEN },
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(overrides(store)).toEqual({});
    history.destroy();
  });
});
