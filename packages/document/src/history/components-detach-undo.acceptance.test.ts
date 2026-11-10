// Acceptance,
// written by Claude from the review of PR 153 at df58bbb2. A detach, whether asked for or made by
// a main's deletion, turns the instance into a frame with the same id and creates its content.
// Undoing it once another person has written into that frame or to a materialised child is the
// confirmed rule: the undo changes nothing and reports the protection, so no object is
// left under an instance. A single person's detach and undo puts back exactly the board before it,
// a main nested in the definition included, and leaves no extra definition behind. A paste of a
// main too large for one transaction is still one step: undone while an instance of it is placed
// offline, it keeps every child of the definition, not only the first transaction's.
import { describe, expect, it } from 'vitest';

import { validateBoard, type Board, type BoardObject, type ObjectId } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import {
  createChild,
  createComponentPair,
  newSticky,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from '../commands/__fixtures__/component-boards.js';
import { mustFindCommand, schemaFunction } from '../commands/__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/** How the instance is detached: by `detachInstance`, or by deleting its main. */
const ROUTES = ['detachInstance', 'deleteObjects of the main'] as const;

/** Children in the pasted main: more than one transaction's worth (1,000 objects). */
const PASTED_CHILDREN = 1_200;

/**
 * An object without its `updatedAt`, which every command stamps.
 *
 * @param object - The object.
 * @returns Its other fields.
 */
function contentOf(object: BoardObject): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt'));
}

/**
 * Every object of a store, by id, without `updatedAt`.
 *
 * @param store - The store.
 * @returns The contents by id.
 */
function contentsOf(store: DocumentStore): Map<string, Record<string, unknown>> {
  return new Map([...store.read().objects].map(([id, object]) => [id, contentOf(object)]));
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
 * The ids of every component on a store, sorted.
 *
 * @param store - The store.
 * @returns The components' ids.
 */
function componentIds(store: DocumentStore): string[] {
  return [...store.read().objects.values()]
    .filter((object) => (object.type as string) === 'component')
    .map((object) => object.id as string)
    .sort();
}

/**
 * Two linked clients, Ada's history, the card main and Ada's instance `inst-1` of it, which Ada
 * then detaches by `route`; Bob has received the detach.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @param route - How the instance is detached.
 * @returns The clients, the link, the history and the materialised children's ids.
 */
function detachedPair(adaClientId: number, bobClientId: number, route: (typeof ROUTES)[number]) {
  const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
    seedMainWithChildren(store);
    placeInstance(store, 'main-card', { instanceId: 'inst-1', x: 1000, y: 0 });
  });
  const history = createHistory(ada, ADA_ID);
  const link = new Link(ada, bob);
  if (route === 'detachInstance') {
    applyCommand(ada, mustFindCommand('detachInstance'), { id: 'inst-1' });
  } else {
    const { result } = applyCommand(ada, deleteObjectsCommand, { ids: ['main-card'] });
    expect(result).toMatchObject({ detachedIds: ['inst-1'] });
  }
  link.deliver();
  expect(mustGet(bob, 'inst-1').type).toBe('frame');
  const materialised = childrenOf(bob, 'inst-1');
  expect(materialised).toHaveLength(4);
  return { ada, bob, link, history, materialised };
}

/**
 * Undoes Ada's detach after Bob's write and checks the rule: nothing changes, the
 * protection is reported, and both clients hold the same valid board with the frame and Bob's
 * work in it.
 *
 * @param pair - What {@link detachedPair} returns, after Bob's write was delivered.
 * @param bobsObject - The object Bob created or changed.
 */
function expectUndoProtected(pair: ReturnType<typeof detachedPair>, bobsObject: string): void {
  const { ada, bob, link, history } = pair;
  const before = contentsOf(ada);
  expect(history.undo()).toBe(false);
  expect(history.lastProtection()).toBeDefined();
  link.deliver();
  expect(contentsOf(ada)).toEqual(before);
  expect(mustGet(ada, 'inst-1').type).toBe('frame');
  expect(mustGet(ada, bobsObject).parentId).toBe('inst-1');
  expectValidAndConverged(ada, bob);
}

describe.each(ORDERS)('undoing a detach another person wrote to ($name)', (order) => {
  it.each(ROUTES)('changes nothing after Bob adds a child to the frame (%s)', (route) => {
    const pair = detachedPair(order.adaClientId, order.bobClientId, route);
    const box = { x: 10, y: 10, width: 100, height: 100 };
    createChild(pair.bob, newSticky('bobs-note', 'inst-1', box), BOB, BOB_ENVIRONMENT);
    pair.link.deliver();
    expectUndoProtected(pair, 'bobs-note');
  });

  it.each(ROUTES)('changes nothing after Bob restyles a materialised child (%s)', (route) => {
    const pair = detachedPair(order.adaClientId, order.bobClientId, route);
    const sticky = pair.materialised.find((id) => mustGet(pair.bob, id).type === 'sticky');
    if (sticky === undefined) throw new Error('expected a materialised sticky');
    applyCommand(
      pair.bob,
      setStyleCommand,
      { changes: [{ id: sticky, style: { color: [0.2, 0.6, 1, 1] } }] },
      BOB,
      BOB_ENVIRONMENT,
    );
    pair.link.deliver();
    expectUndoProtected(pair, sticky);
  });
});

describe('undoing a detach on one client', () => {
  it('puts back exactly the instance when its main holds a nested main, and redo detaches again', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['inner'],
      name: 'outer',
      componentId: 'outer',
    });
    placeInstance(store, 'outer', { instanceId: 'outer-inst', x: 800, y: 0 });
    const history = createHistory(store, ADA_ID);
    const before = contentsOf(store);

    applyCommand(store, mustFindCommand('detachInstance'), { id: 'outer-inst' });
    expect(history.undo()).toBe(true);
    expect(contentsOf(store)).toEqual(before);
    expect(componentIds(store)).toEqual(['inner', 'outer']);
    expect(validateBoard(store.read())).toEqual([]);

    expect(history.redo()).toBe(true);
    expect(mustGet(store, 'outer-inst').type).toBe('frame');
    expect(validateBoard(store.read())).toEqual([]);
  });
});

/**
 * Pastes, as Ada, one main of {@link PASTED_CHILDREN} stickies in one `createObjects`.
 *
 * @param store - Ada's store.
 * @returns The pasted main's id.
 * @throws {Error} When no main was pasted.
 */
function pasteLargeMain(store: DocumentStore): string {
  const main = {
    type: 'component' as const,
    id: 'strip',
    parentId: null,
    x: 0,
    y: 0,
    width: PASTED_CHILDREN * 20,
    height: 100,
    name: 'Strip',
    retired: false,
  };
  const children = [...Array(PASTED_CHILDREN).keys()].map((index) =>
    newSticky(`cell-${String(index)}`, 'strip', { x: index * 20, y: 0, width: 10, height: 10 }),
  );
  applyCommand(store, mustFindCommand('createObjects'), { objects: [main, ...children] });
  const [mainId] = componentIds(store);
  if (mainId === undefined) throw new Error('expected the pasted main');
  expect(childrenOf(store, mainId)).toHaveLength(PASTED_CHILDREN);
  return mainId;
}

describe.each(ORDERS)('undoing a paste of a main split into parts ($name)', (order) => {
  it('keeps every child of the definition for an instance placed offline', () => {
    const ada = new YjsDocumentStore({ clientId: order.adaClientId });
    const bob = new YjsDocumentStore({ clientId: order.bobClientId });
    const history = createHistory(ada, ADA_ID);
    const link = new Link(ada, bob);
    const mainId = pasteLargeMain(ada);
    link.deliver();
    link.disconnect();

    expect(history.undo()).toBe(true);
    placeInstance(bob, mainId, { instanceId: 'late', x: 0, y: 500 }, BOB, BOB_ENVIRONMENT);
    link.reconnect();

    const resolveInstance = schemaFunction('resolveInstance') as (
      board: Board,
      instance: BoardObject,
    ) => { readonly objects: readonly BoardObject[]; readonly issue?: string };
    for (const store of [ada, bob]) {
      expect(mustGet(store, mainId)).toMatchObject({ type: 'component', retired: true });
      expect(childrenOf(store, mainId)).toHaveLength(PASTED_CHILDREN);
      const resolved = resolveInstance(boardOf(store), mustGet(store, 'late'));
      expect(resolved.issue).toBeUndefined();
      expect(resolved.objects).toHaveLength(PASTED_CHILDREN);
    }
    expectValidAndConverged(ada, bob);
  });
});
