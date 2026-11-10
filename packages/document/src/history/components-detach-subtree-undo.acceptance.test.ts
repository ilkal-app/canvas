// Acceptance,
// written by Claude from the re-review of the first fix round for PR 153. The rule for a
// detach's undo covers the whole materialised subtree, not only the frame's own children: when
// the main holds a frame, its materialised copy is a sub-frame of the detached frame, and another
// person's write anywhere below it (a new child in the sub-frame, a restyle of a grandchild) uses
// the undo up. Nothing changes, the protection names that person, and no object is ever left
// under an instance. A detach large enough to be written in several transactions is one step: a
// foreign write in any part protects the whole step.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import {
  createChild,
  createComponentPair,
  newFrame,
  newSticky,
  placeInstance,
} from '../commands/__fixtures__/component-boards.js';
import { mustFindCommand } from '../commands/__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/** How the instance is detached: by `detachInstance`, or by deleting its main. */
const ROUTES = ['detachInstance', 'deleteObjects of the main'] as const;

/** Stickies in the large main's frame: more than one transaction's worth (1,000 objects). */
const LARGE_FRAME_STICKIES = 1_200;

/**
 * An object without its `updatedAt`, which every command stamps.
 *
 * @param store - The store.
 * @returns Every object's other fields, by id.
 */
function contentsOf(store: DocumentStore): Map<string, Record<string, unknown>> {
  return new Map(
    [...store.read().objects].map(([id, object]) => [
      id,
      Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt')),
    ]),
  );
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
 * Two linked clients and Ada's history over a main `main-frame` holding one frame `frame` with
 * `stickies` stickies in it, and Ada's instance `inst-1`; Ada then detaches it by `route`, and
 * Bob has received the detach.
 *
 * @param order - The Yjs client ids.
 * @param order.adaClientId - Ada's.
 * @param order.bobClientId - Bob's.
 * @param route - How the instance is detached.
 * @param stickies - How many stickies the main's frame holds.
 * @returns The clients, the link, the history, the materialised sub-frame, its children and
 *   Bob's client id.
 * @throws {Error} When the detach materialised no sub-frame.
 */
function detachedFramePair(
  order: { readonly adaClientId: number; readonly bobClientId: number },
  route: (typeof ROUTES)[number],
  stickies = 1,
) {
  const [ada, bob] = createComponentPair(order.adaClientId, order.bobClientId, (store) => {
    createChild(store, newFrame('frame', null, { x: 0, y: 0, width: 400, height: 400 }));
    for (const index of [...Array(stickies).keys()]) {
      const box = { x: index % 300, y: 10, width: 10, height: 10 };
      createChild(store, newSticky(`note-${String(index)}`, 'frame', box));
    }
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['frame'],
      name: 'Framed',
      componentId: 'main-frame',
    });
    placeInstance(store, 'main-frame', { instanceId: 'inst-1', x: 1000, y: 0 });
  });
  const history = createHistory(ada, ADA_ID);
  const link = new Link(ada, bob);
  if (route === 'detachInstance') {
    applyCommand(ada, mustFindCommand('detachInstance'), { id: 'inst-1' });
  } else {
    const { result } = applyCommand(ada, deleteObjectsCommand, { ids: ['main-frame'] });
    expect(result).toMatchObject({ detachedIds: ['inst-1'] });
  }
  link.deliver();
  expect(mustGet(bob, 'inst-1').type).toBe('frame');
  const [subFrame] = childrenOf(bob, 'inst-1');
  if (subFrame === undefined) throw new Error('expected the materialised sub-frame');
  expect(mustGet(bob, subFrame).type).toBe('frame');
  const grandchildren = childrenOf(bob, subFrame);
  expect(grandchildren).toHaveLength(stickies);
  return { ada, bob, link, history, subFrame, grandchildren, bobClientId: order.bobClientId };
}

/**
 * Undoes Ada's detach after Bob's write and checks the rule: nothing changes, the
 * protection names Bob, and both clients hold the same valid board with Bob's work in place.
 *
 * @param pair - What {@link detachedFramePair} returns, after Bob's write was delivered.
 * @param bobsObject - The object Bob created or changed.
 * @param bobsParent - Where Bob's object must still be.
 */
function expectUndoProtected(
  pair: ReturnType<typeof detachedFramePair>,
  bobsObject: string,
  bobsParent: string,
): void {
  const { ada, bob, link, history } = pair;
  const before = contentsOf(ada);
  expect(history.undo()).toBe(false);
  const protection = history.lastProtection();
  expect(protection?.objectIds.length).toBeGreaterThan(0);
  expect(protection?.writers).toContain(pair.bobClientId);
  link.deliver();
  expect(contentsOf(ada)).toEqual(before);
  expect(mustGet(ada, 'inst-1').type).toBe('frame');
  expect(mustGet(ada, bobsObject).parentId).toBe(bobsParent);
  expectValidAndConverged(ada, bob);
}

/**
 * Recolours an object as Bob, through `setStyle`.
 *
 * @param bob - Bob's store.
 * @param objectId - The object.
 */
function restyleAsBob(bob: DocumentStore, objectId: string): void {
  applyCommand(
    bob,
    setStyleCommand,
    { changes: [{ id: objectId, style: { color: [0.2, 0.6, 1, 1] } }] },
    BOB,
    BOB_ENVIRONMENT,
  );
}

describe.each(ORDERS)('undoing a detach after a write below the frame ($name)', (order) => {
  it.each(ROUTES)('changes nothing after Bob adds a child to a sub-frame (%s)', (route) => {
    const pair = detachedFramePair(order, route);
    const box = { x: 5, y: 5, width: 10, height: 10 };
    createChild(pair.bob, newSticky('bobs-note', pair.subFrame, box), BOB, BOB_ENVIRONMENT);
    pair.link.deliver();
    expectUndoProtected(pair, 'bobs-note', pair.subFrame);
  });

  it.each(ROUTES)('changes nothing after Bob restyles a grandchild (%s)', (route) => {
    const pair = detachedFramePair(order, route);
    const [grandchild] = pair.grandchildren;
    if (grandchild === undefined) throw new Error('expected a materialised grandchild');
    restyleAsBob(pair.bob, grandchild);
    pair.link.deliver();
    expectUndoProtected(pair, grandchild, pair.subFrame);
  });
});

describe.each(ORDERS)('undoing a detach written in several parts ($name)', (order) => {
  it.each(ROUTES)('changes nothing after Bob adds a child to the frame (%s)', (route) => {
    const pair = detachedFramePair(order, route, LARGE_FRAME_STICKIES);
    const box = { x: 5, y: 5, width: 10, height: 10 };
    createChild(pair.bob, newSticky('bobs-note', 'inst-1', box), BOB, BOB_ENVIRONMENT);
    pair.link.deliver();
    expectUndoProtected(pair, 'bobs-note', 'inst-1');
  });

  it.each(ROUTES)('changes nothing after Bob restyles a grandchild (%s)', (route) => {
    const pair = detachedFramePair(order, route, LARGE_FRAME_STICKIES);
    const grandchild = pair.grandchildren.at(-1);
    if (grandchild === undefined) throw new Error('expected a materialised grandchild');
    restyleAsBob(pair.bob, grandchild);
    pair.link.deliver();
    expectUndoProtected(pair, grandchild, pair.subFrame);
  });
});
