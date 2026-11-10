// Acceptance
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { BOB_ENVIRONMENT } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

/**
 * Two clients with one variant main and its instance.
 *
 * @param adaId - Ada’s fixed Yjs client id.
 * @param bobId - Bob’s fixed Yjs client id.
 * @returns The two stores and seeded card.
 * @throws {Error} If seeding fails.
 */
function pair(adaId: number, bobId: number) {
  let card: ReturnType<typeof seedMainWithChildren> | undefined;
  const [ada, bob] = createComponentPair(adaId, bobId, (store) => {
    card = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: card.mainId,
      axes: [
        { name: 'state', values: ['rest', 'hover'] },
        { name: 'tone', values: ['plain', 'warm'] },
      ],
    });
    placeInstance(store, card.mainId, { instanceId: 'chosen', variant: { state: 'rest' } });
  });
  if (card === undefined) throw new Error('card was not seeded');
  return { ada, bob, card };
}

/**
 * Check both Yjs stores expose the same valid board.
 *
 * @param ada - Ada’s store.
 * @param bob - Bob’s store.
 */
function converged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(ada.read().objects).toEqual(bob.read().objects);
  expect(validateBoard(ada.read())).toEqual([]);
  expect(validateBoard(bob.read())).toEqual([]);
}

describe.each([
  ['Ada lower id', 1, 2],
  ['Bob lower id', 2, 1],
])('variants under concurrency (%s)', (name, adaId, bobId) => {
  it('merges edits to different presets', () => {
    const { ada, bob, card } = pair(adaId, bobId);
    applyCommand(ada, mustFindCommand('setVariantPreset'), {
      componentId: card.mainId,
      axis: 'state',
      value: 'hover',
      path: card.noteId,
      override: { text: 'Hover' },
    });
    applyCommand(
      bob,
      mustFindCommand('setVariantPreset'),
      {
        componentId: card.mainId,
        axis: 'tone',
        value: 'warm',
        path: card.boxId,
        override: { fill: [0, 1, 0, 1] },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    converged(ada, bob);
    expect(fieldOf(ada, card.mainId, 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { [card.noteId]: { text: 'Hover' } },
      'tone=plain': {},
      'tone=warm': { [card.boxId]: { fill: [0, 1, 0, 1] } },
    });
  });

  it('merges edits to different paths of one preset', () => {
    const { ada, bob, card } = pair(adaId, bobId);
    applyCommand(ada, mustFindCommand('setVariantPreset'), {
      componentId: card.mainId,
      axis: 'state',
      value: 'hover',
      path: card.noteId,
      override: { text: 'Hover' },
    });
    applyCommand(
      bob,
      mustFindCommand('setVariantPreset'),
      {
        componentId: card.mainId,
        axis: 'state',
        value: 'hover',
        path: card.boxId,
        override: { fill: [0, 1, 0, 1] },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    converged(ada, bob);
    expect(fieldOf(ada, card.mainId, 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { [card.noteId]: { text: 'Hover' }, [card.boxId]: { fill: [0, 1, 0, 1] } },
      'tone=plain': {},
      'tone=warm': {},
    });
  });

  it('documents that renaming an axis can lose a concurrent edit under the old preset key', () => {
    const { ada, bob, card } = pair(adaId, bobId);
    applyCommand(ada, mustFindCommand('setVariantPreset'), {
      componentId: card.mainId,
      axis: 'state',
      value: 'hover',
      path: card.noteId,
      override: { text: 'Before' },
    });
    exchange(ada, bob);
    applyCommand(ada, mustFindCommand('setVariantAxes'), {
      componentId: card.mainId,
      axes: [
        { name: 'mode', values: ['rest', 'hover'] },
        { name: 'tone', values: ['plain', 'warm'] },
      ],
      renames: { axes: [{ from: 'state', to: 'mode' }] },
    });
    applyCommand(
      bob,
      mustFindCommand('setVariantPreset'),
      {
        componentId: card.mainId,
        axis: 'state',
        value: 'hover',
        path: card.boxId,
        override: { fill: [0, 1, 0, 1] },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    converged(ada, bob);
    expect(fieldOf(ada, card.mainId, 'variantPresets')).toEqual({
      'mode=rest': {},
      'mode=hover': { [card.noteId]: { text: 'Before' } },
      'tone=plain': {},
      'tone=warm': {},
    });
  });

  it('converges when a selection switch races a preset edit', () => {
    const { ada, bob, card } = pair(adaId, bobId);
    applyCommand(ada, mustFindCommand('setInstanceVariant'), {
      id: 'chosen',
      variant: { state: 'hover' },
    });
    applyCommand(
      bob,
      mustFindCommand('setVariantPreset'),
      {
        componentId: card.mainId,
        axis: 'state',
        value: 'hover',
        path: card.noteId,
        override: { text: 'Hover' },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    converged(ada, bob);
    expect(fieldOf(ada, 'chosen', 'variant')).toEqual({ state: 'hover' });
    expect(fieldOf(ada, card.mainId, 'variantPresets')).toEqual({
      'state=rest': {},
      'state=hover': { [card.noteId]: { text: 'Hover' } },
      'tone=plain': {},
      'tone=warm': {},
    });
  });
});
