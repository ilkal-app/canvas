// A stored drop shadow the schema refuses survives writes that do not set one. A
// replay that passed no door can leave a shadow out of this build's range; the
// reader leaves it out (`codec/shadow-tolerance.ts`), and a later unrelated write of the object (a
// move, a lock, a rename, a restyle of another field) rebuilds its `style` group from the read
// object. The writer carries the stored value through, so it is not deleted; only an explicit
// shadow, or `null`, replaces it. Alone and between two synced clients. Real raw updates.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { DEFAULT_SHADOW, type Shadow } from '@canvas/schema';

import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from './move-objects.js';
import { renameFrameCommand } from './rename-frame.js';
import { setLockedCommand } from './set-locked.js';
import { setStyleCommand } from './set-style.js';

/** A shadow past this build's offset range: a newer build's, or a peer that skipped the door. */
const OUT_OF_RANGE = { x: 2000, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };

const SHAPE = 'shape-box';
const FRAME = 'frame-plan';

const boards: { destroy: () => void }[] = [];

afterEach(() => {
  for (const board of boards.splice(0)) board.destroy();
});

/**
 * A writer holding the fixture board, with a refused shadow replayed onto a shape and a frame.
 *
 * @returns The writer.
 */
function writerWithRefusedShadows(): YjsDocumentStore {
  const board = fixtureGateBoard();
  boards.push(
    {
      destroy: () => {
        board.hub.destroy();
      },
    },
    board.writer,
  );
  const update = rawUpdate(board, (objects) => {
    mergeGroup(objects, SHAPE, 'style', { shadow: OUT_OF_RANGE });
    mergeGroup(objects, FRAME, 'style', { shadow: OUT_OF_RANGE });
  });
  board.writer.applyUpdate(update, RELAY);
  return board.writer;
}

/**
 * The `shadow` an object's stored `style` group holds, read raw from the store's state.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns The stored value.
 */
function storedShadow(store: YjsDocumentStore, id: string): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.encodeState());
  const style = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(id)?.get('style');
  doc.destroy();
  return (style as Readonly<Record<string, unknown>> | undefined)?.shadow;
}

describe('a replayed shadow the schema refuses', () => {
  it('reads as none and stays stored through a move, a lock, a rename and another restyle', () => {
    const store = writerWithRefusedShadows();
    expect(store.get(SHAPE as never)).toMatchObject({ shadow: undefined });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: SHAPE, by: { x: 30, y: 0 } }] });
    expect(storedShadow(store, SHAPE)).toEqual(OUT_OF_RANGE);
    applyCommand(store, setLockedCommand, { ids: [SHAPE], locked: true });
    expect(storedShadow(store, SHAPE)).toEqual(OUT_OF_RANGE);
    applyCommand(store, setLockedCommand, { ids: [SHAPE], locked: false });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: SHAPE, style: { fill: [0, 1, 0, 1] } }],
    });
    expect(storedShadow(store, SHAPE)).toEqual(OUT_OF_RANGE);
    expect(store.get(SHAPE as never)).toMatchObject({ fill: [0, 1, 0, 1], shadow: undefined });
    applyCommand(store, renameFrameCommand, { id: FRAME, name: 'Renamed' });
    applyCommand(store, setStyleCommand, { changes: [{ id: FRAME, style: { clip: true } }] });
    expect(storedShadow(store, FRAME)).toEqual(OUT_OF_RANGE);
    expect(store.read().issues).toEqual([]);
  });

  it('is replaced by an explicit shadow, and removed by null', () => {
    const store = writerWithRefusedShadows();
    const shadow: Shadow = { ...DEFAULT_SHADOW, y: 12 };
    applyCommand(store, setStyleCommand, { changes: [{ id: SHAPE, style: { shadow } }] });
    expect(storedShadow(store, SHAPE)).toEqual(shadow);
    expect(store.get(SHAPE as never)).toMatchObject({ shadow });
    applyCommand(store, setStyleCommand, { changes: [{ id: FRAME, style: { shadow: null } }] });
    expect(storedShadow(store, FRAME)).toBeNull();
    expect(store.get(FRAME as never)).toMatchObject({ shadow: null });
  });

  it('survives another client’s unrelated writes, and both clients see an explicit removal', () => {
    const ada = writerWithRefusedShadows();
    const bob = new YjsDocumentStore({ clientId: 3 });
    boards.push(bob);
    exchange(ada, bob);
    expect(bob.get(SHAPE as never)).toMatchObject({ shadow: undefined });
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: SHAPE, by: { x: 0, y: 40 } }] });
    applyCommand(bob, setStyleCommand, { changes: [{ id: SHAPE, style: { cornerRadius: 6 } }] });
    applyCommand(ada, setLockedCommand, { ids: [SHAPE], locked: true });
    exchange(ada, bob);
    expect(storedShadow(ada, SHAPE)).toEqual(OUT_OF_RANGE);
    expect(storedShadow(bob, SHAPE)).toEqual(OUT_OF_RANGE);
    expect(ada.read().objects).toEqual(bob.read().objects);
    applyCommand(ada, setLockedCommand, { ids: [SHAPE], locked: false });
    applyCommand(ada, setStyleCommand, { changes: [{ id: SHAPE, style: { shadow: null } }] });
    exchange(ada, bob);
    expect(storedShadow(bob, SHAPE)).toBeNull();
    expect(bob.get(SHAPE as never)).toMatchObject({ shadow: null });
    expect(ada.read().objects).toEqual(bob.read().objects);
  });
});
