import { describe, expect, it } from 'vitest';

import type { ComponentObject, InstanceObject, ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { runCommand } from './run-command.js';

// The variant commands' edges: what they refuse or keep when an object is missing,
// a choice is cleared, a stored main lacks a preset entry, or an instance sits in a plain frame.

const ENVIRONMENT = { clock: () => 1, createId: () => 'generated' as ObjectId };

/**
 * A main with a `state` axis and an instance of it.
 *
 * @returns The store and the ids.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  const instanceId = placeInstance(store, card.mainId, { instanceId: 'inst', x: 2000 });
  return { store, ...card, instanceId };
}

/**
 * The error codes of a command that must be refused.
 *
 * @param store - The store.
 * @param name - The command's name.
 * @param input - Its input.
 * @returns The codes.
 * @throws {Error} When the command applies.
 */
function refused(store: YjsDocumentStore, name: string, input: unknown): string[] {
  const outcome = runCommand(store, ADA, mustFindCommand(name), input as never, ENVIRONMENT);
  if (outcome.status === 'applied') throw new Error(`${name} applied`);
  return outcome.errors.map(({ code }) => code);
}

describe('variant command edges', () => {
  it('refuses a missing instance, a missing main and an instance whose main is gone', () => {
    const { store, mainId } = seeded();
    expect(refused(store, 'setInstanceVariant', { id: 'nobody', variant: {} })).toEqual([
      'missing-object',
    ]);
    expect(
      refused(store, 'setVariantPreset', {
        componentId: 'nobody',
        axis: 'state',
        value: 'rest',
        path: 'x',
        override: { isHidden: true },
      }),
    ).toEqual(['missing-object']);
    const orphan = { ...mustGet(store, 'inst'), id: 'orphan', mainId: 'gone' } as InstanceObject;
    store.transact(ADA, (transaction) => {
      transaction.setObject(orphan);
    });
    expect(
      refused(store, 'setInstanceVariant', { id: 'orphan', variant: { state: 'rest' } }),
    ).toEqual(['missing-main']);
    expect(mustGet(store, mainId).type).toBe('component');
  });

  it('removes the selection once every choice is cleared', () => {
    const { store } = seeded();
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'inst',
      variant: { state: 'hover' },
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'inst',
      variant: { state: null },
    });
    expect(mustGet(store, 'inst')).not.toHaveProperty('variant');
  });

  it('refuses an axis renamed twice', () => {
    const { store, mainId } = seeded();
    expect(
      refused(store, 'setVariantAxes', {
        componentId: mainId,
        axes: [{ name: 'mode', values: ['rest', 'hover'] }],
        renames: {
          axes: [
            { from: 'state', to: 'mode' },
            { from: 'state', to: 'mode' },
          ],
        },
      }),
    ).toContain('invalid-input');
  });

  it('writes a preset a stored main lacks the entry for', () => {
    const { store, mainId, noteId } = seeded();
    const main = mustGet(store, mainId) as ComponentObject;
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...main, variantPresets: { 'state=rest': {} } });
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { isHidden: true },
    });
    expect((mustGet(store, mainId) as ComponentObject).variantPresets).toMatchObject({
      'state=hover': { [noteId]: { isHidden: true } },
    });
  });

  it('renames past records with no selection and instances in plain frames', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [{ name: 'state', values: ['a', 'b'] }],
    });
    applyCommand(store, mustFindCommand('createFrame'), {
      frame: {
        id: 'box',
        type: 'frame',
        x: 3000,
        y: 0,
        width: 400,
        height: 400,
        name: 'Box',
        clip: false,
        background: null,
      },
      childIds: [],
    });
    placeInstance(store, 'inner', { instanceId: 'framed', parentId: 'box', x: 10, y: 10 });
    placeInstance(store, 'inner', { instanceId: 'nested', x: 2000, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['nested'],
      name: 'Outer',
      componentId: 'outer',
    });
    placeInstance(store, 'outer', {
      instanceId: 'root',
      x: 5000,
      y: 0,
      overrides: { nested: { isHidden: false } },
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [{ name: 'state', values: ['c', 'b'] }],
      renames: { values: [{ axis: 'state', from: 'a', to: 'c' }] },
    });
    expect((mustGet(store, 'root') as InstanceObject).overrides).toEqual({
      nested: { isHidden: false },
    });
    expect((mustGet(store, 'inner') as ComponentObject).variantAxes).toEqual([
      { name: 'state', values: ['c', 'b'] },
    ]);
  });
});
