// Acceptance: the same retention as undo, under the existing `restoreBoard`. Restoring a state
// older than a main does not remove the main's definition: a main absent from the chosen state is
// retired and kept with whatever subtree is absent from it too, so an instance someone placed
// offline meanwhile still resolves (retired, never `missing-main`). Members the chosen state holds
// go back where it had them, leaving a main that wrapped them as the owner's empty placeholder.
// The restore is still one undo step. No snapshot key or layout change.
import { describe, expect, it } from 'vitest';

import { validateBoard, type Board, type BoardObject, type ObjectId } from '@canvas/schema';

import { ADA_ID, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newSticky,
  placeInstance,
  seedLeafMain,
} from './__fixtures__/component-boards.js';
import {
  fieldOf,
  mustFindCommand,
  overridesOf,
  schemaFunction,
} from './__fixtures__/component-fixtures.js';
import { restoreBoardCommand } from './restore-board.js';

/** What the schema's `resolveInstance` answers. */
interface ResolvedInstance {
  readonly objects: readonly BoardObject[];
  readonly issue?: string;
  readonly isMainRetired: boolean;
}

/**
 * An object without its `updatedAt`, which every command stamps.
 *
 * @param object - The object, or nothing.
 * @returns Its other fields.
 */
function contentOf(object: BoardObject | undefined): Record<string, unknown> | undefined {
  if (object === undefined) return undefined;
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt'));
}

/**
 * Every object of a store, by id, without `updatedAt`.
 *
 * @param store - The store.
 * @returns The contents by id.
 */
function contentsOf(store: DocumentStore): Map<string, Record<string, unknown> | undefined> {
  return new Map([...store.read().objects].map(([id, object]) => [id, contentOf(object)]));
}

/**
 * Resolves a stored instance through the schema's `resolveInstance`.
 *
 * @param store - The store.
 * @param instanceId - The instance.
 * @returns What the resolver answers.
 */
function resolve(store: DocumentStore, instanceId: string): ResolvedInstance {
  const resolveInstance = schemaFunction('resolveInstance') as (
    board: Board,
    instance: BoardObject,
  ) => ResolvedInstance;
  return resolveInstance(boardOf(store), mustGet(store, instanceId));
}

/**
 * The children of an object, sorted.
 *
 * @param store - The store.
 * @param parentId - The parent.
 * @returns The children's ids.
 */
function childrenOf(store: DocumentStore, parentId: string): string[] {
  return [...store.references.childrenOf(parentId as ObjectId)].sort();
}

/**
 * Ada's and Bob's linked clients: Ada writes `before`, the chosen state is taken, Ada writes
 * `after`, Bob receives everything, and Ada's history starts.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @param before - What the chosen state holds.
 * @param after - What Ada writes after it.
 * @returns The clients, the link, the history and the chosen state.
 */
function restorePair(
  adaClientId: number,
  bobClientId: number,
  before: (store: DocumentStore) => void,
  after: (store: DocumentStore) => void,
) {
  const ada = new YjsDocumentStore({ clientId: adaClientId });
  before(ada);
  const chosen = ada.encodeState();
  after(ada);
  const bob = new YjsDocumentStore({ clientId: bobClientId });
  bob.applyUpdate(ada.encodeState(), RELAY);
  const link = new Link(ada, bob);
  const history = createHistory(ada, ADA_ID);
  return { ada, bob, link, history, chosen };
}

/**
 * Bob places an instance of `main` offline, 300 × 200, its leaf's text overridden.
 *
 * @param bob - Bob's store.
 * @param path - The override path.
 * @returns The instance's id.
 */
function placeLate(bob: DocumentStore, path: string): ObjectId {
  const late = placeInstance(
    bob,
    'main',
    { x: 500, y: 0, width: 300, height: 200, instanceId: 'late' },
    BOB,
    BOB_ENVIRONMENT,
  );
  applyCommand(
    bob,
    mustFindCommand('setInstanceOverride'),
    { id: late, path, override: { text: 'Hi' } },
    BOB,
    BOB_ENVIRONMENT,
  );
  return late;
}

/**
 * Checks the late instance kept its main, size and overrides on a store.
 *
 * @param store - The store.
 * @param late - The instance.
 * @param path - Its override path.
 */
function expectLateKept(store: DocumentStore, late: string, path: string): void {
  expect(mustGet(store, late)).toMatchObject({ type: 'instance', width: 300, height: 200 });
  expect(fieldOf(store, late, 'mainId')).toBe('main');
  expect(overridesOf(store, late)).toEqual({ [path]: { text: 'Hi' } });
}

describe.each(ORDERS)('restoreBoard over a main ($name)', ({ adaClientId, bobClientId }) => {
  it('retires a wholly newer main and keeps its subtree for an offline instance, in one undo step', () => {
    const { ada, bob, link, history, chosen } = restorePair(
      adaClientId,
      bobClientId,
      (store) =>
        createChild(store, newSticky('kept', null, { x: 0, y: 900, width: 80, height: 80 })),
      (store) => seedLeafMain(store, 'main', { x: 0, y: 0 }),
    );
    const leafBefore = contentOf(mustGet(ada, 'main-leaf'));
    const before = contentsOf(ada);

    link.disconnect();
    applyCommand(ada, restoreBoardCommand, { state: chosen });
    expect(fieldOf(ada, 'main', 'retired')).toBe(true);
    expect(childrenOf(ada, 'main')).toEqual(['main-leaf']);
    expect(contentOf(mustGet(ada, 'main-leaf'))).toEqual(leafBefore);
    expect(history.undo()).toBe(true);
    expect(contentsOf(ada)).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(fieldOf(ada, 'main', 'retired')).toBe(true);

    const late = placeLate(bob, 'main-leaf');
    link.reconnect();
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expectLateKept(store, late, 'main-leaf');
      expect(childrenOf(store, 'main')).toEqual(['main-leaf']);
      const resolved = resolve(store, late);
      expect(resolved.issue).toBeUndefined();
      expect(resolved.isMainRetired).toBe(true);
      expect(resolved.objects).toHaveLength(1);
      expect(resolved.objects[0]).toMatchObject({ type: 'sticky', text: 'Hi' });
      expect(validateBoard(store.read())).toEqual([]);
    }
    history.destroy();
  });

  it('puts wrapped members back where the chosen state had them, leaving the main an empty placeholder', () => {
    const { ada, bob, link, history, chosen } = restorePair(
      adaClientId,
      bobClientId,
      (store) => {
        createChild(store, newFrame('home', null, { x: 1000, y: 1000, width: 600, height: 600 }));
        createChild(store, newSticky('note', 'home', { x: 20, y: 30, width: 160, height: 160 }));
      },
      (store) =>
        applyCommand(store, mustFindCommand('createComponent'), {
          ids: ['note'],
          name: 'Note card',
          componentId: 'main',
        }),
    );
    const chosenNote = (() => {
      const historical = new YjsDocumentStore();
      historical.applyUpdate(chosen, RELAY);
      const note = contentOf(mustGet(historical, 'note'));
      historical.destroy();
      return note;
    })();
    const before = contentsOf(ada);

    link.disconnect();
    applyCommand(ada, restoreBoardCommand, { state: chosen });
    expect(history.undo()).toBe(true);
    expect(contentsOf(ada)).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    const late = placeLate(bob, 'note');
    link.reconnect();

    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(contentOf(mustGet(store, 'note'))).toEqual(chosenNote);
      expect(mustGet(store, 'main').type).toBe('component');
      expect(fieldOf(store, 'main', 'retired')).toBe(true);
      expect(childrenOf(store, 'main')).toEqual([]);
      expectLateKept(store, late, 'note');
      expect(resolve(store, late)).toEqual({ objects: [], issue: undefined, isMainRetired: true });
      expect(validateBoard(store.read())).toEqual([]);
    }
    history.destroy();
  });
});
