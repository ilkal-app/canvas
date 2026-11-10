import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';

import {
  ADA,
  BOB,
  BODY,
  createSyncedPair,
  exchange,
  fixtureBoard,
  fixtureObject,
  id,
  RELAY,
} from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

// Sync tests for the grouped-field layout: concurrent edits to fields in
// different groups, or in a group and a field with its own key, merge; concurrent edits to one
// group keep one writer's group whole. Placement (`parentId`, `x`, `y`, `rotation`) is one group,
// so a reparent and a move of one object never mix; the command-level cases, with the frames'
// geometry, are in commands/placement.sync.test.ts.

/**
 * Runs one write on each of two synced stores, then exchanges their updates.
 *
 * @param adaWrites - Ada's patch, by object id.
 * @param bobWrites - Bob's patch, by object id.
 * @param stores - The two stores; a fresh synced pair of fixture boards by default.
 * @returns Ada's and Bob's stores, converged.
 */
function concurrently(
  adaWrites: Readonly<Record<string, Partial<BoardObject>>>,
  bobWrites: Readonly<Record<string, Partial<BoardObject>>>,
  stores: [YjsDocumentStore, YjsDocumentStore] = createSyncedPair(),
): [YjsDocumentStore, YjsDocumentStore] {
  const [ada, bob] = stores;
  ada.transact(ADA, (transaction) => {
    for (const [objectId, patch] of Object.entries(adaWrites)) {
      transaction.patchObject(id(objectId), patch);
    }
  });
  bob.transact(BOB, (transaction) => {
    for (const [objectId, patch] of Object.entries(bobWrites)) {
      transaction.patchObject(id(objectId), patch);
    }
  });
  exchange(ada, bob);
  expect(ada.read().objects).toEqual(bob.read().objects);
  expect(ada.read().issues).toEqual([]);
  return [ada, bob];
}

describe('the grouped layout merges edits of different groups', () => {
  it('when one client moves a shape and another recolours it', () => {
    const [ada] = concurrently({ 'shape-box': { x: 50, y: 60 } }, { 'shape-box': { fill: null } });
    expect(ada.get(id('shape-box'))).toMatchObject({ x: 50, y: 60, fill: null });
  });

  it('when one client restyles a sticky and another edits its text', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), { color: [0.5, 0.9, 0.5, 1] });
    });
    bob.transact(BOB, (transaction) => {
      const style = fixtureObject('sticky-idea', 'sticky').runs[0]?.style ?? BODY;
      transaction.insertText(id('sticky-idea'), 0, 'New: ', style);
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('sticky-idea'))).toMatchObject({
      color: [0.5, 0.9, 0.5, 1],
      text: 'New: Ship the beta 😀',
    });
  });

  it('when one client reorders an object and another resizes it', () => {
    const [ada] = concurrently({ 'text-title': { z: 'a0V' } }, { 'text-title': { width: 333 } });
    expect(ada.get(id('text-title'))).toMatchObject({ z: 'a0V', width: 333 });
  });

  it('when one client reorders an object, another moves it and a third locks it', () => {
    const [ada, bob] = createSyncedPair();
    const carol = new YjsDocumentStore();
    exchange(ada, carol);
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-star'), { z: 'a5' });
    });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('shape-star'), { x: 7, rotation: 1 });
    });
    carol.transact(RELAY, (transaction) => {
      transaction.patchObject(id('shape-star'), { locked: true });
    });
    exchange(ada, bob);
    exchange(bob, carol);
    exchange(ada, carol);
    expect(ada.read().objects).toEqual(carol.read().objects);
    expect(bob.read().objects).toEqual(carol.read().objects);
    expect(ada.get(id('shape-star'))).toMatchObject({ z: 'a5', x: 7, rotation: 1, locked: true });
  });

  it('when one client drags a connector end and another restyles the connector', () => {
    const [ada] = concurrently(
      { 'connector-flow': { to: { kind: 'point', x: 5, y: 5 } } },
      { 'connector-flow': { route: 'curved' } },
    );
    expect(ada.get(id('connector-flow'))).toMatchObject({
      to: { kind: 'point', x: 5, y: 5 },
      route: 'curved',
    });
  });
});

describe('the grouped layout keeps one writer per group', () => {
  it('when two clients change the placement of one object, one placement wins whole', () => {
    const [ada] = concurrently({ 'shape-box': { x: 1 } }, { 'shape-box': { rotation: 0.5 } });
    const shape = ada.get(id('shape-box'));
    const original = fixtureObject('shape-box', 'shape');
    const kept = [
      { x: 1, rotation: original.rotation },
      { x: original.x, rotation: 0.5 },
    ];
    expect(kept).toContainEqual({ x: shape?.x, rotation: shape?.rotation });
  });

  it('when one client reparents an object and another moves it, one placement wins whole', () => {
    const star = fixtureObject('shape-star', 'shape');
    const [ada] = concurrently(
      { 'shape-star': { parentId: id('frame-plan'), x: 500, y: 300 } },
      { 'shape-star': { x: 7, y: 8 } },
    );
    const placement = ada.get(id('shape-star'));
    expect([
      { parentId: 'frame-plan', x: 500, y: 300 },
      { parentId: star.parentId, x: 7, y: 8 },
    ]).toContainEqual({ parentId: placement?.parentId, x: placement?.x, y: placement?.y });
  });

  it('when two clients restyle different fields of one object, one restyle wins whole', () => {
    const [ada] = concurrently(
      { 'shape-box': { fill: null } },
      { 'shape-box': { cornerRadius: 3 } },
    );
    const shape = ada.get(id('shape-box'));
    const original = fixtureObject('shape-box', 'shape');
    expect([
      { fill: null, cornerRadius: original.cornerRadius },
      { fill: original.fill, cornerRadius: 3 },
    ]).toContainEqual({
      fill: shape?.type === 'shape' && shape.fill,
      cornerRadius: shape?.type === 'shape' && shape.cornerRadius,
    });
  });

  it('when two clients edit one vertex, one vertex wins whole', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v2', x: 111, y: 0, mirror: 'both' });
    });
    bob.transact(BOB, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v2', x: 100, y: 0, mirror: 'none' });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const path = ada.get(id('path-squiggle'));
    expect([
      { id: 'v2', x: 111, y: 0, mirror: 'both' },
      { id: 'v2', x: 100, y: 0, mirror: 'none' },
    ]).toContainEqual(path?.type === 'path' && path.vertices[1]);
  });
});

describe('undo in the grouped layout', () => {
  it('removes a vertex it added, and restores one it replaced', () => {
    const [ada] = createSyncedPair();
    const history = createHistory(ada, 'user:ada' as PrincipalId);
    const before = ada.get(id('path-squiggle'));
    ada.transact(ADA, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v9', x: 9, y: 9, mirror: 'none' });
    });
    ada.transact(ADA, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v1', x: 1, y: 1, mirror: 'none' });
    });
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(ada.get(id('path-squiggle'))).toEqual(before);
    history.destroy();
  });
});

describe('ids of the fixture objects these tests edit', () => {
  it('exist on the fixture board', () => {
    for (const objectId of [
      'shape-box',
      'shape-star',
      'sticky-idea',
      'text-title',
      'connector-flow',
    ]) {
      expect(fixtureBoard().objects.has(objectId as ObjectId)).toBe(true);
    }
  });
});
