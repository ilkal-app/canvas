import { describe, expect, it } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { BoardObject, InstanceObject, ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../engine/__fixtures__/component-board.js';
import { LOCAL_USER_ORIGIN } from '../engine/demo-document.js';

import { componentListOf } from './components/component-list.js';
import { instanceOverrideRows, type SlotPlacement } from './instance-override-rows.js';
import { containingMainsOf, slotSwapChoices, swapOptionChoices } from './slot-swap-choices.js';

/**
 * The card board with a second main, "Check".
 *
 * @returns The board.
 */
function swapBoard(): YjsDocumentStore {
  const { store } = createComponentBoard();
  createRectangle(store, 'check-mark', null, { x: 800, y: 100, width: 20, height: 20 });
  mustRun(store, 'createComponent', { ids: ['check-mark'], name: 'Check', componentId: 'check' });
  return store;
}

/**
 * Patches one object, as a remote peer may.
 *
 * @param store - The board.
 * @param id - The object.
 * @param patch - Its new fields.
 */
function patch(store: YjsDocumentStore, id: string, patch: Partial<BoardObject>): void {
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    transaction.patchObject(id as ObjectId, patch);
  });
}

/**
 * The card instance's slot row's placement.
 *
 * @param store - The board.
 * @returns The placement.
 * @throws {Error} When there is no slot row.
 */
function slotOf(store: YjsDocumentStore): SlotPlacement {
  const instance = store.get('inst' as ObjectId) as InstanceObject;
  const slot = instanceOverrideRows(store, instance).find((row) => row.slot !== undefined)?.slot;
  if (slot === undefined) throw new Error('no slot row');
  return slot;
}

/**
 * The choices' names.
 *
 * @param store - The board.
 * @param placement - The slot.
 * @returns The names.
 */
function names(store: YjsDocumentStore, placement: SlotPlacement = slotOf(store)): string[] {
  return slotSwapChoices(store, placement, componentListOf(store)).map(({ name }) => name);
}

describe('slotSwapChoices', () => {
  it('names a retired or missing stored main', () => {
    const store = swapBoard();
    patch(store, 'badge', { retired: true });
    expect(names(store)).toEqual(['Badge', 'Check']);
    expect(names(store, { ...slotOf(store), storedMainId: 'gone' as ObjectId })).toEqual([
      'Main not found',
      'Check',
    ]);
  });

  it('keeps offering the main shown when the options are narrowed past it', () => {
    const store = swapBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    patch(store, 'badge-in-card', { swapOptions: ['badge' as ObjectId] });
    expect(names(store)).toEqual(['Badge', 'Check']);
  });
});

describe('containingMainsOf', () => {
  it('lists the mains around an object outermost first and ends at a parent cycle', () => {
    const store = swapBoard();
    const dot = store.get('dot' as ObjectId);
    if (dot === undefined) throw new Error('no dot');
    expect(containingMainsOf(store, dot)).toEqual(['badge']);
    patch(store, 'badge', { parentId: 'dot' as ObjectId });
    expect(containingMainsOf(store, dot)).toEqual(['badge']);
  });
});

describe('swapOptionChoices', () => {
  it('lists the mains the slot can expand, and those its options already list', () => {
    const store = swapBoard();
    const slot = (): InstanceObject => store.get('badge-in-card' as ObjectId) as InstanceObject;
    const list = (): string[] =>
      swapOptionChoices(store, slot(), ['card' as ObjectId], componentListOf(store)).map(
        ({ name }) => name,
      );
    expect(list()).toEqual(['Badge', 'Check']);
    patch(store, 'badge-in-card', { swapOptions: ['card' as ObjectId] });
    expect(list()).toEqual(['Badge', 'Card', 'Check']);
  });
});
