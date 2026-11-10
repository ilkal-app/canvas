// Review fixes: a swap may not reach a main that contains the instance, and swap
// targets in presets (and in the record being written) are on the board the checks read.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';
import { containingMains } from './containing-mains.js';
import { createInstanceCommand } from './create-instance.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';
import { SubBoard } from './sub-board.js';

const GREEN: [number, number, number, number] = [0.2, 0.9, 0.2, 1];

/**
 * Mains `a` (holding `slot`, an instance of `b`), `b` and `c`.
 *
 * @returns The store.
 */
function setup(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'b', { x: 1000, y: 0 });
  seedLeafMain(store, 'a', { x: 0, y: 0 });
  placeInstance(store, 'b', { parentId: 'a', instanceId: 'slot', x: 20, y: 20 });
  seedLeafMain(store, 'c', { x: 2000, y: 0 });
  return store;
}

describe('a swap reaching a main that contains the instance', () => {
  it('refuses createInstance inside the main it swaps in, writing nothing', () => {
    const store = setup();
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: 'a',
      instanceId: 'placed',
      parentId: 'c',
      x: 2020,
      y: 20,
      overrides: { slot: { mainId: 'c' } },
    });
    expect(codesOf(errors)).toEqual(['instance-cycle']);
    expect(errors[0]?.path).toEqual(['overrides', 'slot', 'mainId']);
    expect(store.get('placed' as ObjectId)).toBeUndefined();
  });

  it('refuses setInstanceOverride on an instance inside that main', () => {
    const store = setup();
    const placed = placeInstance(store, 'a', { instanceId: 'placed', parentId: 'c', x: 20 });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: 'slot',
          override: { mainId: 'c' },
        }),
      ),
    ).toEqual(['instance-cycle']);
  });

  it('refuses a main that contains the instance through an instance of its container', () => {
    const store = setup();
    seedLeafMain(store, 'd', { x: 3000, y: 0 });
    const placed = placeInstance(store, 'a', { instanceId: 'placed', parentId: 'd', x: 20 });
    placeInstance(store, 'd', { instanceId: 'd-one', parentId: 'c', x: 2020, y: 20 });
    placeInstance(store, 'd', { instanceId: 'd-two', parentId: 'c', x: 2040, y: 40 });
    expect([...containingMains(store, mustGet(store, placed))].sort()).toEqual(['c', 'd']);
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: 'slot',
          override: { mainId: 'c' },
        }),
      ),
    ).toEqual(['instance-cycle']);
    // A main the instance is not inside stays a valid target.
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'b' },
    });
  });
});

describe('swap targets in presets', () => {
  /**
   * `a` with a state axis (rest, hover) and `b-two`, another main for the slot.
   *
   * @returns The store and the second main's leaf.
   */
  function withAxis(): { store: YjsDocumentStore; leaf: ObjectId } {
    const store = setup();
    const leaf = seedLeafMain(store, 'b-two', { x: 4000, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'a',
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    return { store, leaf };
  }

  const preset = (path: string, override: Record<string, unknown>) => ({
    componentId: 'a',
    axis: 'state',
    value: 'hover',
    path,
    override,
  });

  it('accepts a live target, and paths under the swap its preset makes', () => {
    const { store, leaf } = withAxis();
    const set = mustFindCommand('setVariantPreset');
    applyCommand(store, set, preset('slot', { mainId: 'b-two' }));
    applyCommand(store, set, preset(`slot/${leaf}`, { color: GREEN }));
    applyCommand(store, mustFindCommand('resetVariantPreset'), {
      componentId: 'a',
      axis: 'state',
      value: 'hover',
      path: `slot/${leaf}`,
      fields: ['color'],
    });
  });

  it('refuses an unusable target with its own code', () => {
    const { store } = withAxis();
    const set = mustFindCommand('setVariantPreset');
    expect(codesOf(expectRejected(store, set, preset('slot', { mainId: 'a' })))).toEqual([
      'instance-cycle',
    ]);
    expect(codesOf(expectRejected(store, set, preset('slot', { mainId: 'missing' })))).toEqual([
      'invalid-override',
    ]);
  });

  it('validates an instance path under a swap its selected preset makes', () => {
    const { store, leaf } = withAxis();
    applyCommand(store, mustFindCommand('setVariantPreset'), preset('slot', { mainId: 'b-two' }));
    const hover = placeInstance(store, 'a', { instanceId: 'hover', variant: { state: 'hover' } });
    const rest = placeInstance(store, 'a', { instanceId: 'rest', x: 600 });
    applyCommand(store, setInstanceOverrideCommand, {
      id: hover,
      path: `slot/${leaf}`,
      override: { color: GREEN },
    });
    expect(overridesOf(store, hover)).toEqual({ [`slot/${leaf}`]: { color: GREEN } });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: rest,
          path: `slot/${leaf}`,
          override: { color: GREEN },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });
});

describe('SubBoard.addInstanceDefinitions', () => {
  it('reads the own records of an instance whose main is missing', () => {
    const store = setup();
    const lost = {
      ...mustGet(store, 'slot'),
      id: 'lost' as ObjectId,
      parentId: null,
      pageId: null,
      mainId: 'gone' as ObjectId,
      overrides: { inner: { mainId: 'c' as ObjectId } },
    };
    const board = new SubBoard(store, [lost]);
    board.addInstanceDefinitions(lost.id);
    expect(board.toBoard().objects.get('c' as ObjectId)).toMatchObject({ type: 'component' });
  });
});
