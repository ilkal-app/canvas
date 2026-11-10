// Acceptance: command validation follows the effective definition of each slot.
import { describe, expect, it } from 'vitest';

import { resolveInstance, type InstanceObject, type ObjectId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import {
  AGENT_FOR_BOB,
  codesOf,
  expectRefusedBy,
  fieldOf,
  mustFindCommand,
  overridesOf,
} from './__fixtures__/component-fixtures.js';
import { createInstanceCommand } from './create-instance.js';
import { resetInstanceOverridesCommand } from './reset-instance-overrides.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';

const GREEN: [number, number, number, number] = [0.2, 0.9, 0.2, 1];

function setup() {
  const store = new YjsDocumentStore();
  const aChild = seedLeafMain(store, 'icon-a', { x: 1000, y: 0 });
  const bChild = seedLeafMain(store, 'icon-b', { x: 1300, y: 0 });
  seedLeafMain(store, 'button', { x: 0, y: 0 });
  placeInstance(store, 'icon-a', {
    parentId: 'button',
    instanceId: 'slot',
    x: 20,
    y: 20,
  });
  const placed = placeInstance(store, 'button', { instanceId: 'placed', x: 2000, y: 0 });
  return { store, aChild, bChild, placed };
}

function options(store: YjsDocumentStore, value: readonly string[]): void {
  const slot = mustGet(store, 'slot') as InstanceObject;
  store.transact(ADA, (transaction) => {
    transaction.patchObject(slot.id, { swapOptions: value as ObjectId[] });
  });
}

describe('instance swap commands', () => {
  it('sets an allowed live main and allows swapping to the stored main', () => {
    const { store, placed } = setup();
    options(store, ['icon-a', 'icon-b']);
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    expect(overridesOf(store, placed)).toEqual({ slot: { mainId: 'icon-b' } });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-a' },
    });
    expect(overridesOf(store, placed)).toEqual({ slot: { mainId: 'icon-a' } });
    const refused = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'button' },
    });
    expect(codesOf(refused)).toEqual(['instance-cycle']);
  });

  it('refuses a missing, non-component, retired, or disallowed target without writing', () => {
    const { store, placed, bChild } = setup();
    options(store, ['icon-a']);
    const missing = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'missing' },
    });
    expect(codesOf(missing)).toEqual(['invalid-override']);
    expect(missing[0]?.path).toEqual(['override', 'mainId']);
    const nonComponent = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: bChild },
    });
    expect(codesOf(nonComponent)).toEqual(['invalid-override']);
    expect(nonComponent[0]?.path).toEqual(['override', 'mainId']);
    const disallowed = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    expect(codesOf(disallowed)).toEqual(['invalid-override']);
    expect(disallowed[0]?.path).toEqual(['override', 'mainId']);
    const retired = mustGet(store, 'icon-b');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(retired.id, { retired: true });
    });
    options(store, ['icon-a', 'icon-b']);
    const errors = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    expect(codesOf(errors)).toEqual(['invalid-override']);
    expect(errors[0]?.path).toEqual(['override', 'mainId']);
  });

  it('refuses a swap to an ancestor or a main containing the ancestor', () => {
    const { store, placed } = setup();
    const ancestor = expectRejected(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'button' },
    });
    expect(codesOf(ancestor)).toEqual(['instance-cycle']);
    seedLeafMain(store, 'wrapper', { x: 1600, y: 0 });
    placeInstance(store, 'button', {
      parentId: 'wrapper',
      instanceId: 'nested-button',
      x: 20,
      y: 20,
    });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: 'slot',
          override: { mainId: 'wrapper' },
        }),
      ),
    ).toEqual(['instance-cycle']);
  });

  it('counts the target main’s nested slots toward the depth limit', () => {
    const { store, placed } = setup();
    for (let level = 1; level <= 5; level += 1) {
      seedLeafMain(store, `deep-${String(level)}`, { x: 2000 + level * 300, y: 0 });
      if (level > 1)
        placeInstance(store, `deep-${String(level - 1)}`, {
          parentId: `deep-${String(level)}`,
          instanceId: `deep-slot-${String(level)}`,
          x: 20,
          y: 20,
        });
    }
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: 'slot',
          override: { mainId: 'deep-5' },
        }),
      ),
    ).toEqual(['instance-depth']);
  });

  it('validates deeper paths against the current effective main and restores old paths on reset', () => {
    const { store, placed, aChild, bChild } = setup();
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: `slot/${aChild}`,
      override: { color: GREEN },
    });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: `slot/${bChild}`,
      override: { color: GREEN },
    });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: `slot/${aChild}`,
          override: { color: GREEN },
        }),
      ),
    ).toEqual(['invalid-override-path']);
    applyCommand(store, resetInstanceOverridesCommand, {
      id: placed,
      path: 'slot',
      fields: ['mainId'],
    });
    expect(overridesOf(store, placed)).toEqual({
      [`slot/${aChild}`]: { color: GREEN },
      [`slot/${bChild}`]: { color: GREEN },
    });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: `slot/${aChild}`,
      override: { isHidden: false },
    });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: `slot/${bChild}`,
          override: { color: GREEN },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });

  it('validates createInstance deeper paths against a swap in the same input', () => {
    const { store, aChild, bChild } = setup();
    const created = applyCommand(store, createInstanceCommand, {
      componentId: 'button',
      instanceId: 'created',
      x: 2400,
      y: 0,
      overrides: { slot: { mainId: 'icon-b' }, [`slot/${bChild}`]: { color: GREEN } },
    }).result.instanceId;
    expect(overridesOf(store, created)).toEqual({
      slot: { mainId: 'icon-b' },
      [`slot/${bChild}`]: { color: GREEN },
    });
    expect(
      codesOf(
        expectRejected(store, createInstanceCommand, {
          componentId: 'button',
          instanceId: 'invalid',
          x: 2800,
          y: 0,
          overrides: { slot: { mainId: 'icon-b' }, [`slot/${aChild}`]: { color: GREEN } },
        }),
      ),
    ).toEqual(['invalid-override-path']);
  });

  it('applies swap target refusals to createInstance atomically', () => {
    const { store } = setup();
    options(store, ['icon-a']);
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: 'button',
      instanceId: 'invalid',
      x: 2400,
      y: 0,
      overrides: { slot: { mainId: 'icon-b' } },
    });
    expect(codesOf(errors)).toEqual(['invalid-override']);
    expect(errors[0]?.path).toEqual(['overrides', 'slot', 'mainId']);
    expect(store.get('invalid' as ObjectId)).toBeUndefined();
  });

  it('sets and clears swapOptions, validating the instance, targets, and ownership', () => {
    const { store, placed, bChild } = setup();
    const command = mustFindCommand('setSwapOptions');
    applyCommand(store, command, { id: 'slot', options: ['icon-a', 'icon-b'] });
    expect(fieldOf(store, 'slot', 'swapOptions')).toEqual(['icon-a', 'icon-b']);
    expect(codesOf(expectRejected(store, command, { id: bChild, options: ['icon-a'] }))).toEqual([
      'unsupported-type',
    ]);
    expect(codesOf(expectRejected(store, command, { id: 'slot', options: ['missing'] }))).toEqual([
      'invalid-input',
    ]);
    expect(
      codesOf(expectRejected(store, command, { id: 'slot', options: ['icon-a', 'icon-a'] })),
    ).toEqual(['invalid-input']);
    expect(
      codesOf(
        expectRefusedBy(store, AGENT_FOR_BOB, command, {
          id: 'slot',
          options: ['icon-b'],
        }),
      ),
    ).toEqual(['not-own-main']);
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    applyCommand(store, command, { id: 'slot', options: ['icon-a'] });
    expect(overridesOf(store, placed).slot).toEqual({ mainId: 'icon-b' });
    applyCommand(store, command, { id: 'slot', options: null });
    expect(fieldOf(store, 'slot', 'swapOptions')).toBeUndefined();
  });

  it('undoes one swap by restoring the previous record exactly', () => {
    const { store, placed, bChild } = setup();
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { isHidden: false },
    });
    const before = overridesOf(store, placed).slot;
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'icon-b' },
    });
    expect(history.undo()).toBe(true);
    expect(overridesOf(store, placed).slot).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(overridesOf(store, placed).slot).toEqual({ ...before, mainId: 'icon-b' });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: `slot/${bChild}`,
      override: { color: GREEN },
    });
    const current = mustGet(store, placed) as InstanceObject;
    expect(resolveInstance(store.read(), current).objects.map(({ id }) => id)).toContain(
      `placed/slot/${bChild}`,
    );
    history.destroy();
  });
});
