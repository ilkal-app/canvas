import { describe, expect, it } from 'vitest';

import type { BoardObject, InstanceObject, ObjectId } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  placeInstance,
  seedLeafMain,
} from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand } from './__fixtures__/component-fixtures.js';
import type { BoardReader } from './command.js';
import { resolveOverridePath } from './override-path-names.js';

// The name walk's cost: every split of a path is tried, but each layer and step count
// is read once, so a long path of repeated names against a deep tree stays cheap.

const DEPTH = 12;
const STEPS = 300;

/**
 * A main holding frames nested twelve deep, each named "a" beside a rectangle named "b", and an
 * instance of it.
 *
 * @returns The store and the instance.
 */
function deepMain(): { store: YjsDocumentStore; instanceId: string } {
  const store = new YjsDocumentStore();
  const rename = mustFindCommand('renameObject');
  let parent: string | null = null;
  for (let level = 0; level < DEPTH; level += 1) {
    const id = `frame-${String(level)}`;
    createChild(store, newFrame(id, parent, { x: level, y: level, width: 400, height: 400 }));
    applyCommand(store, rename, { id, name: 'a' });
    const twin = `twin-${String(level)}`;
    createChild(store, newRectangle(twin, parent, { x: 0, y: 0, width: 4, height: 4 }));
    applyCommand(store, rename, { id: twin, name: 'b' });
    parent = id;
  }
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['frame-0', 'twin-0'],
    name: 'Deep',
    componentId: 'deep',
  });
  return { store, instanceId: placeInstance(store, 'deep', { instanceId: 'deep-1', x: 900 }) };
}

describe('resolveOverridePath on a pathological path', () => {
  it('refuses a long path of repeated names quickly', () => {
    const { store, instanceId } = deepMain();
    const started = performance.now();
    const errors = expectRejected(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: Array.from({ length: STEPS }, () => 'a').join('/'),
      override: { fill: [1, 0, 0, 1] },
    });
    expect(codesOf(errors)).toEqual(['invalid-override-path']);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('resolves a path down the nested frames by name', () => {
    const { store, instanceId } = deepMain();
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'a/a/b',
      override: { fill: [1, 0, 0, 1] },
    });
    const instance = store.get(instanceId as never);
    expect(instance?.type === 'instance' ? instance.overrides : undefined).toEqual({
      'twin-2': { fill: [1, 0, 0, 1] },
    });
  });
});

describe('resolveOverridePath review fixes', () => {
  /**
   * A main holding two frames named "Vector", only the first holding a child named "Child".
   *
   * @returns The store and an instance of the main.
   */
  function twinFrames(): { store: YjsDocumentStore; instanceId: string } {
    const store = new YjsDocumentStore();
    const rename = mustFindCommand('renameObject');
    createChild(store, newFrame('vector-1', null, { x: 0, y: 0, width: 100, height: 100 }));
    createChild(store, newFrame('vector-2', null, { x: 200, y: 0, width: 100, height: 100 }));
    createChild(store, newRectangle('child', 'vector-1', { x: 0, y: 0, width: 10, height: 10 }));
    applyCommand(store, rename, { id: 'vector-1', name: 'Vector' });
    applyCommand(store, rename, { id: 'vector-2', name: 'Vector' });
    applyCommand(store, rename, { id: 'child', name: 'Child' });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['vector-1', 'vector-2'],
      name: 'Twins',
      componentId: 'twins',
    });
    return { store, instanceId: placeInstance(store, 'twins', { instanceId: 'twins-1', x: 900 }) };
  }

  it('refuses a shared step even when only one branch completes, or none does', () => {
    const { store, instanceId } = twinFrames();
    for (const path of ['Vector/Child', 'Vector/Missing']) {
      const errors = expectRejected(store, mustFindCommand('setInstanceOverride'), {
        id: instanceId,
        path,
        override: { fill: [1, 0, 0, 1] },
      });
      expect(codesOf(errors)).toEqual(['ambiguous-override-path']);
    }
  });

  it('resets a stored preset record whose child a swap moved away', () => {
    const store = new YjsDocumentStore();
    const aChild = seedLeafMain(store, 'icon-a', { x: 1000, y: 0 });
    seedLeafMain(store, 'icon-b', { x: 1300, y: 0 });
    seedLeafMain(store, 'button', { x: 0, y: 0 });
    placeInstance(store, 'icon-a', { parentId: 'button', instanceId: 'slot', x: 20, y: 20 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'button',
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    const preset = { componentId: 'button', axis: 'state', value: 'hover' };
    const stored = `slot/${aChild}`;
    const setPreset = mustFindCommand('setVariantPreset');
    applyCommand(store, setPreset, { ...preset, path: stored, override: { isHidden: true } });
    applyCommand(store, setPreset, { ...preset, path: 'slot', override: { mainId: 'icon-b' } });
    applyCommand(store, mustFindCommand('resetVariantPreset'), { ...preset, path: stored });
    const main = store.get('button' as never);
    expect(main?.type === 'component' ? main.variantPresets?.['state=hover'] : undefined).toEqual({
      slot: { mainId: 'icon-b' },
    });
  });
});

describe('name paths in resets', () => {
  /**
   * The twin-frame board with "Child" overridden on its instance and in a hover preset.
   *
   * @returns The store and the instance.
   */
  function overridden(): { store: YjsDocumentStore; instanceId: string } {
    const store = new YjsDocumentStore();
    const rename = mustFindCommand('renameObject');
    createChild(store, newFrame('holder', null, { x: 0, y: 0, width: 100, height: 100 }));
    createChild(store, newFrame('empty', null, { x: 200, y: 0, width: 100, height: 100 }));
    createChild(store, newRectangle('child', 'holder', { x: 0, y: 0, width: 10, height: 10 }));
    createChild(store, newRectangle('twin-1', null, { x: 400, y: 0, width: 10, height: 10 }));
    createChild(store, newRectangle('twin-2', null, { x: 500, y: 0, width: 10, height: 10 }));
    applyCommand(store, rename, { id: 'holder', name: 'Holder' });
    applyCommand(store, rename, { id: 'empty', name: 'Empty' });
    applyCommand(store, rename, { id: 'child', name: 'Child' });
    applyCommand(store, rename, { id: 'twin-1', name: 'Twin' });
    applyCommand(store, rename, { id: 'twin-2', name: 'Twin' });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['holder', 'empty', 'twin-1', 'twin-2'],
      name: 'Box',
      componentId: 'box',
      variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    const instanceId = placeInstance(store, 'box', { instanceId: 'box-1', x: 900 });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'child',
      override: { fill: [1, 0, 0, 1] },
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'box',
      axis: 'state',
      value: 'hover',
      path: 'child',
      override: { fill: [1, 0, 0, 1] },
    });
    return { store, instanceId };
  }

  it('resets an instance record and a preset record by their names', () => {
    const { store, instanceId } = overridden();
    applyCommand(store, mustFindCommand('resetInstanceOverrides'), {
      id: instanceId,
      path: 'Holder/Child',
    });
    const instance = store.get(instanceId as never);
    expect(instance?.type === 'instance' ? instance.overrides : undefined).toEqual({});
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'box',
      axis: 'state',
      value: 'hover',
      path: 'Holder/Child',
    });
    const main = store.get('box' as never);
    expect(main?.type === 'component' ? main.variantPresets?.['state=hover'] : undefined).toEqual(
      {},
    );
  });

  it('refuses a reset by a shared name, and finds nothing in an empty frame', () => {
    const { store, instanceId } = overridden();
    const reset = { componentId: 'box', axis: 'state', value: 'hover' };
    for (const [command, input] of [
      ['resetInstanceOverrides', { id: instanceId, path: 'Twin' }],
      ['resetVariantPreset', { ...reset, path: 'Twin' }],
    ] as const) {
      expect(codesOf(expectRejected(store, mustFindCommand(command), input))).toEqual([
        'ambiguous-override-path',
      ]);
    }
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setInstanceOverride'), {
          id: instanceId,
          path: 'Empty/Child',
          override: { fill: [1, 0, 0, 1] },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });
});

describe('a cycle a raw write made (#313 review)', () => {
  it('stays bounded when a main holds an instance of itself named as two steps', () => {
    const base = {
      parentId: null,
      pageId: 'page-1',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:ada',
      createdAt: 0,
      updatedAt: 0,
    };
    const main = { ...base, id: 'loop', type: 'component', name: 'Loop', retired: false };
    // The slot's id is "a" and its name "a/a": one step or two, at every level.
    const slot = {
      ...base,
      id: 'a',
      parentId: 'loop',
      pageId: null,
      type: 'instance',
      name: 'a/a',
      mainId: 'loop',
      overrides: {},
    };
    const placed = { ...base, id: 'placed', type: 'instance', mainId: 'loop', overrides: {} };
    const objects = new Map<string, unknown>([
      ['loop', main],
      ['a', slot],
      ['placed', placed],
    ]);
    const reader = {
      get: (id: ObjectId) => objects.get(id) as BoardObject | undefined,
      references: { childrenOf: (id: ObjectId) => (id === 'loop' ? ['a' as ObjectId] : []) },
    } as unknown as BoardReader;
    const started = performance.now();
    const resolution = resolveOverridePath(
      reader,
      placed as unknown as InstanceObject,
      Array.from({ length: 60 }, () => 'a').join('/'),
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect('error' in resolution).toBe(true);
  });
});
