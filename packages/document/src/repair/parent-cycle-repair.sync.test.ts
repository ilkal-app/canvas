// Concurrent moves that close a parent cycle: Ada moves frame-outer into frame-side
// while Bob moves frame-side into frame-outer. Each command is valid where it runs; after the
// merge each placement names the other. The repair re-roots the cycle's lowest-id member
// (frame-outer) at the root, where the cycle drew it, and every client writes the same values.
import { describe, expect, it } from 'vitest';

import { validateBoard, type BoardObject } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { groupCommand } from '../commands/group.js';
import { ADA_ID, BOB_ID, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { BOB, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  createFrameClients,
  Mesh,
  moveInto,
  thirdFrame,
  worldOf,
} from './__fixtures__/cycle-fixtures.js';
import {
  boardOf,
  expectValidAndConverged,
  ORDERS,
  recordRepairs,
} from './__fixtures__/repair-fixtures.js';

/**
 * Ada moves frame-outer into frame-side, Bob frame-side into frame-outer, a second later.
 *
 * @param ada - Ada's store.
 * @param bob - Bob's store.
 * @returns Each moved frame as its mover left it.
 */
function moveIntoEachOther(ada: YjsDocumentStore, bob: YjsDocumentStore) {
  moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
  moveInto(bob, 'frame-side', 'frame-outer', { x: -600, y: 100 }, BOB, NOW + 1_000);
  return { adaOuter: mustGet(ada, 'frame-outer'), bobSide: mustGet(bob, 'frame-side') };
}

/**
 * Where frame-outer was drawn once the cycle closed: its placement in frame-side, with
 * frame-side's own placement taken as if at the root (the cycle walked once from frame-outer).
 *
 * @param adaOuter - frame-outer as Ada moved it.
 * @param bobSide - frame-side as Bob moved it.
 * @returns frame-outer's world transform, rounded.
 */
function drawnAt(adaOuter: BoardObject, bobSide: BoardObject): number[] {
  const objects = new Map([
    [adaOuter.id, adaOuter],
    [bobSide.id, { ...bobSide, parentId: null }],
  ]);
  return worldOf({ objects }, 'frame-outer');
}

describe.each(ORDERS)('frames moved into each other ($name)', ({ adaClientId, bobClientId }) => {
  it('re-roots the lowest-id frame where it was drawn; contents stay with their frames', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const link = new Link(ada, bob);
    link.disconnect();
    const { adaOuter, bobSide } = moveIntoEachOther(ada, bob);
    const [adaRepairs, bobRepairs] = [recordRepairs(ada), recordRepairs(bob)];
    link.reconnect();
    const outer = mustGet(ada, 'frame-outer');
    expect(outer.parentId).toBeNull();
    expect(worldOf(ada.read(), 'frame-outer')).toEqual(drawnAt(adaOuter, bobSide));
    // The other member keeps its parent and its placement in it; contents keep theirs.
    expect(mustGet(ada, 'frame-side')).toEqual(bobSide);
    expect(mustGet(ada, 'frame-inner').parentId).toBe('frame-outer');
    expect(mustGet(ada, 'rect-side').parentId).toBe('frame-side');
    expect(ada.read().objects.size).toBe(11);
    // A product write: system origin, same values on both clients, no updatedAt stamp.
    expect(outer.updatedAt).toBe(adaOuter.updatedAt);
    expect(adaRepairs.map(({ changes }) => changes.origin)).toEqual([SYSTEM_ORIGIN]);
    expect(bobRepairs.map(({ written }) => written)).toEqual(
      adaRepairs.map(({ written }) => written),
    );
    expectValidAndConverged(ada, bob);
  });

  it('converges when both clients repair at once, and a second exchange writes nothing', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const [fromAda, fromBob] = [ada.encodeStateVector(), bob.encodeStateVector()];
    moveIntoEachOther(ada, bob);
    const [adaMove, bobMove] = [ada.encodeState(fromBob), bob.encodeState(fromAda)];
    const [adaRepairs, bobRepairs] = [recordRepairs(ada), recordRepairs(bob)];
    const [adaBefore, bobBefore] = [ada.encodeStateVector(), bob.encodeStateVector()];
    ada.applyUpdate(bobMove, RELAY);
    bob.applyUpdate(adaMove, RELAY);
    expect(adaRepairs).toHaveLength(1);
    expect(bobRepairs).toHaveLength(1);
    expect(bobRepairs[0]?.written).toEqual(adaRepairs[0]?.written);
    // Each receives the other's repair: identical values, nothing left to repair.
    ada.applyUpdate(bob.encodeState(adaBefore), RELAY);
    bob.applyUpdate(ada.encodeState(bobBefore), RELAY);
    expect(adaRepairs).toHaveLength(1);
    expect(bobRepairs).toHaveLength(1);
    expectValidAndConverged(ada, bob);
  });

  it('is no one’s undo step, and each user’s undo leaves a valid board', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const [adaHistory, bobHistory] = [createHistory(ada, ADA_ID), createHistory(bob, BOB_ID)];
    const link = new Link(ada, bob);
    link.disconnect();
    moveIntoEachOther(ada, bob);
    link.reconnect();
    const repaired = mustGet(ada, 'frame-outer');
    expect(repaired.parentId).toBeNull();
    expect([adaHistory.canUndo(), bobHistory.canUndo()]).toEqual([true, true]);
    // Bob's undo takes frame-side back to the root; frame-outer stays where the repair put it.
    expect(bobHistory.undo()).toBe(true);
    expect(bobHistory.canUndo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'frame-side').parentId).toBeNull();
    expect(mustGet(ada, 'frame-outer')).toEqual(repaired);
    expectValidAndConverged(ada, bob);
    // Ada's move was overwritten by the repair's later write: her undo cannot fight it.
    adaHistory.undo();
    expect(adaHistory.canUndo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'frame-outer').parentId).toBeNull();
    expectValidAndConverged(ada, bob);
  });

  it('closes no cycle through a descendant moved while its frame was moved into it', () => {
    // Ada takes frame-inner out of frame-outer, then frame-outer into frame-inner; Bob, apart,
    // nudges frame-inner, which writes its whole placement, parent frame-outer included.
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const link = new Link(ada, bob);
    link.disconnect();
    moveInto(ada, 'frame-inner', null, { x: 0, y: 400 });
    moveInto(ada, 'frame-outer', 'frame-inner', { x: 10, y: 10 });
    moveInto(bob, 'frame-inner', 'frame-outer', { x: 10, y: 0 }, BOB);
    link.reconnect();
    // When Bob's placement of frame-inner wins, the two frames close a cycle, broken at
    // frame-inner (its id is the lower); when Ada's wins, no cycle forms and frame-inner is at
    // the root already. Either way it ends at the root, holding its contents.
    expect(mustGet(ada, 'frame-inner').parentId).toBeNull();
    expect(mustGet(ada, 'rect-inner').parentId).toBe('frame-inner');
    expectValidAndConverged(ada, bob);
  });
});

describe.each(ORDERS)('longer cycles and more clients ($name)', ({ adaClientId, bobClientId }) => {
  it('breaks a cycle of three frames made by three clients at its lowest id', () => {
    const stores = createFrameClients([adaClientId, bobClientId, 3], [thirdFrame()]);
    const [ada, bob, cat] = stores as [YjsDocumentStore, YjsDocumentStore, YjsDocumentStore];
    const mesh = new Mesh(stores);
    moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
    moveInto(bob, 'frame-side', 'frame-third', { x: 700, y: 0 }, BOB);
    moveInto(cat, 'frame-third', 'frame-outer', { x: -1400, y: 50 }, BOB);
    const sentBefore = [...mesh.sent];
    mesh.deliver();
    expect(mustGet(ada, 'frame-outer').parentId).toBeNull();
    expect(mustGet(ada, 'frame-side').parentId).toBe('frame-third');
    expect(mustGet(ada, 'frame-third').parentId).toBe('frame-outer');
    // Each editor writes at most one repair of the one cycle: bounded, no storm.
    const repairUpdates = mesh.sent.map((count, index) => count - (sentBefore[index] ?? 0));
    expect(repairUpdates.every((count) => count <= 1)).toBe(true);
    for (const other of [bob, cat]) expectValidAndConverged(ada, other);
    const settled = [...mesh.sent];
    mesh.deliver();
    expect(mesh.sent).toEqual(settled);
  });

  it('breaks a cycle through a group: a frame into a grouped frame, the group into it', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const link = new Link(ada, bob);
    const { result } = applyCommand(ada, groupCommand, {
      ids: ['frame-side', 'rect-free'],
      groupId: 'group-new',
    });
    link.deliver();
    link.disconnect();
    // The cycle runs frame-outer → frame-side → the group → frame-outer.
    moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
    moveInto(bob, result.groupId, 'frame-outer', { x: -500, y: 0 }, BOB);
    link.reconnect();
    expect(mustGet(ada, 'frame-outer').parentId).toBeNull();
    expect(mustGet(ada, 'frame-side').parentId).toBe(result.groupId);
    expect(mustGet(ada, result.groupId).parentId).toBe('frame-outer');
    expect(mustGet(ada, 'rect-free').parentId).toBe(result.groupId);
    expectValidAndConverged(ada, bob);
  });
});

describe.each(ORDERS)('a cycle an undo closes ($name)', ({ adaClientId, bobClientId }) => {
  it('is repaired after the step, with nothing left for a second pass', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const history = createHistory(ada, ADA_ID);
    const link = new Link(ada, bob);
    moveInto(ada, 'frame-side', 'frame-outer', { x: -600, y: 100 });
    moveInto(ada, 'frame-side', null, { x: 600, y: -100 });
    link.deliver();
    moveInto(bob, 'frame-outer', 'frame-side', { x: 800, y: 0 }, BOB);
    link.deliver();
    const repairs = recordRepairs(ada);
    // Undoing Ada's move out puts frame-side back in frame-outer, which is now in frame-side.
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(repairs.map(({ changes }) => changes.updated)).toEqual([[id('frame-outer')]]);
    expect(mustGet(ada, 'frame-outer').parentId).toBeNull();
    expect(mustGet(ada, 'frame-side').parentId).toBe('frame-outer');
    expect(validateBoard(boardOf(ada))).toEqual([]);
    expectValidAndConverged(ada, bob);
  });
});
