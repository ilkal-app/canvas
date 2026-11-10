// Fix round 3 (PROTECT across the parts of a grouped step): a frame F holds a
// group G holding members, and the step's part boundary falls between F and G. A peer locks a
// member; the person's undo (of a paste) or redo (of a delete) keeps the member and G, and must
// keep F too, as one step would: an object a later-applied part kept counts as touched for the
// part that holds what it lies in. Nothing is re-rooted and no repair is written.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import type { NewObject } from '../commands/new-object-schema.js';
import { setLockedCommand } from '../commands/set-locked.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { ADA, BOB } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/** The fields `createObjects` generates, which a listed object leaves out. */
const GENERATED = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

/**
 * Root shapes besides the scenario, so the 1,000-object part boundary falls between F and G: a
 * paste writes them first (F is the 1,000th object), a delete last (referrers first: the members
 * and G are the 997th to 1,000th, F the 1,001st).
 */
const PASTE_FILLERS = 999;
const DELETE_FILLERS = 996;

/**
 * A template of each type the scenario needs, from the large-board mix.
 *
 * @returns A frame, a group and a shape.
 * @throws {Error} When the mix lacks one.
 */
function templates(): { frame: BoardObject; group: BoardObject; shape: BoardObject } {
  const mix = createLargeBoardObjects(200, 81);
  const frame = mix.find((object) => object.type === 'frame');
  const group = mix.find((object) => object.type === 'group');
  const shape = mix.find((object) => object.type === 'shape');
  if (frame === undefined || group === undefined || shape === undefined) {
    throw new Error('the mix has frames, groups and shapes');
  }
  return { frame, group, shape };
}

/**
 * The scenario's objects: fillers at the root, then F, G in F, and three members in G.
 *
 * @param prefix - Prefixes every id.
 * @param fillerCount - How many fillers.
 * @returns The objects, frame and group ids, and the first member's id.
 */
function scenario(prefix: string, fillerCount: number) {
  const { frame, group, shape } = templates();
  const id = (name: string) => `${prefix}${name}` as ObjectId;
  const fillers = Array.from({ length: fillerCount }, (unused, index) => ({
    ...shape,
    id: id(`f${String(index)}`),
    parentId: null,
    x: index * 60,
  }));
  const members = [1, 2, 3].map((index) => ({
    ...shape,
    id: id(`m${String(index)}`),
    parentId: id('g'),
    x: index * 60,
  }));
  const objects: BoardObject[] = [
    ...fillers,
    { ...frame, id: id('f'), parentId: null },
    { ...group, id: id('g'), parentId: id('f') },
    ...members,
  ] as BoardObject[];
  return { objects, frameId: id('f'), groupId: id('g'), memberId: id('m1') };
}

/**
 * Counts the store's own repair writes (system-origin local transactions) while `run` runs.
 *
 * @param store - The store.
 * @param run - What to run.
 * @returns How many there were.
 */
function repairsDuring(store: YjsDocumentStore, run: () => void): number {
  let repairs = 0;
  const stop = store.subscribeUpdates(({ isLocal, origin }) => {
    if (isLocal && origin.kind === 'system') repairs += 1;
  });
  run();
  stop();
  return repairs;
}

/**
 * Has a peer lock one object with its own command (a write to that object alone, not to its
 * group), and hands the change to the store.
 *
 * @param store - The person's store.
 * @param id - The object locked.
 */
function peerLocks(store: YjsDocumentStore, id: ObjectId): void {
  const peer = new YjsDocumentStore({ clientId: 3_009 });
  peer.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
  const before = peer.encodeStateVector();
  applyCommand(peer, setLockedCommand, { ids: [id], locked: true }, BOB);
  store.applyUpdate(peer.encodeSyncState(before), SYSTEM_ORIGIN);
  peer.destroy();
}

describe('the creation guard across the parts of a grouped step', { timeout: 30_000 }, () => {
  it('keeps the frame of a kept group when the paste is undone', () => {
    const store = new YjsDocumentStore({ clientId: 3_001 });
    const history = createHistory(store, ADA_ID);
    const { objects } = scenario('', PASTE_FILLERS);
    const listed = objects.map(
      (object) =>
        Object.fromEntries(
          Object.entries(object).filter(([key]) => !GENERATED.has(key)),
        ) as unknown as NewObject,
    );
    // The precondition: the first part writes F but not G.
    const sizes: number[] = [];
    const stop = store.subscribe((changes) => sizes.push(changes.created.length));
    const { result } = applyCommand(
      store,
      createObjectsCommand,
      { objects: listed },
      ADA,
      testEnvironment(4),
    );
    const [frameId, groupId, memberId] = [PASTE_FILLERS, PASTE_FILLERS + 1, PASTE_FILLERS + 2].map(
      (index) => result.ids[index] ?? ('' as ObjectId),
    ) as [ObjectId, ObjectId, ObjectId];
    stop();
    expect(sizes[0]).toBe(PASTE_FILLERS + 1);
    peerLocks(store, memberId);
    const repairs = repairsDuring(store, () => {
      expect(history.undo()).toBe(true);
    });
    expect(repairs).toBe(0);
    expect(store.get(frameId)).toBeDefined();
    expect(store.get(groupId)?.parentId).toBe(frameId);
    expect(store.get(memberId)?.parentId).toBe(groupId);
    expect(store.read().objects.size).toBeLessThan(objects.length);
  });

  it('keeps the frame of a kept group when the delete is redone', () => {
    const store = new YjsDocumentStore({ clientId: 3_002 });
    const { objects, frameId, groupId, memberId } = scenario('s', DELETE_FILLERS);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of objects) transaction.setObject(object);
    });
    const history = createHistory(store, ADA_ID);
    const fillers = objects.slice(0, DELETE_FILLERS).map(({ id }) => id);
    // The precondition: the first part deletes G but not F.
    const afterFirst: boolean[] = [];
    const stop = store.subscribe(() => {
      afterFirst.push(store.get(frameId) !== undefined && store.get(groupId) === undefined);
    });
    applyCommand(store, deleteObjectsCommand, { ids: [frameId, ...fillers] });
    stop();
    expect(afterFirst).toEqual([true, false]);
    expect(history.undo()).toBe(true);
    expect(store.get(groupId)?.parentId).toBe(frameId);
    peerLocks(store, memberId);
    const repairs = repairsDuring(store, () => {
      expect(history.redo()).toBe(true);
    });
    expect(repairs).toBe(0);
    expect(store.get(frameId)).toBeDefined();
    expect(store.get(groupId)?.parentId).toBe(frameId);
    expect(store.get(memberId)?.parentId).toBe(groupId);
    expect(store.read().objects.size).toBeLessThan(objects.length);
  });
});
