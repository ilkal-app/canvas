import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  moveObjectsCommand,
  OBJECTS_MAP_NAME,
  runCommand,
  SYSTEM_ORIGIN,
  type ChangeSet,
  type CommandError,
  type DocumentStore,
} from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// Dropping into and out of frames. The select board's
// frame-f is 300 × 200 at (400, 0) and holds rect-c, 50 × 50 at (420, 20) on the board; rect-a is
// 100 × 50 at (0, 0) on the root.

/** frame-f's box on the board. */
const FRAME_F = { x: 400, y: 0, width: 300, height: 200, rotation: 0 };

/**
 * Writes a `z` that is not a fractional-index key into an object, as a peer that skips
 * validation would: the store validates only local writes, so it comes in as a remote update.
 *
 * @param store - The store.
 * @param objectId - The object.
 */
function writeInvalidKeyRemotely(store: DocumentStore, objectId: string): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId)?.set('z', 'not-a-key');
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), SYSTEM_ORIGIN);
}

function setUp(onCommandRefused?: (errors: readonly CommandError[]) => void) {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  let notified = 0;
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onChange: () => (notified += 1),
    ...(onCommandRefused ? { onCommandRefused } : {}),
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    controller.handle(
      { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
      1,
    );
  };
  const drag = (from: Point, to: Point) => {
    at('pointerDown', from);
    at('pointerMove', to);
    at('pointerUp', to);
  };
  return { store, controller, changeSets, at, drag, notifications: () => notified };
}

describe('SelectController: dropping into frames', () => {
  it('takes an object dragged out of its frame onto the root, in one change set', () => {
    const { store, changeSets, drag } = setUp();
    drag({ x: 430, y: 30 }, { x: 430, y: 280 });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.updated).toEqual(['rect-c']);
    expect(store.get(id('rect-c'))).toMatchObject({ parentId: null, x: 420, y: 270 });
  });

  it('outlines the frame an object would land in while dragging, and takes it in on release', () => {
    const { store, controller, changeSets, at } = setUp();
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 200, y: 400 });
    expect(controller.overlay().dropTarget).toBeUndefined();
    at('pointerMove', { x: 460, y: 60 });
    expect(controller.overlay().dropTarget).toEqual(FRAME_F);
    at('pointerUp', { x: 460, y: 60 });
    expect(controller.overlay().dropTarget).toBeUndefined();
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-a'))).toMatchObject({ parentId: 'frame-f', x: 50, y: 50 });
  });

  it('keeps an object dragged within its frame in that frame, outlining it', () => {
    const { store, controller, changeSets, at } = setUp();
    const z = store.get(id('rect-c'))?.z;
    at('pointerDown', { x: 430, y: 30 });
    at('pointerMove', { x: 530, y: 80 });
    expect(controller.overlay().dropTarget).toEqual(FRAME_F);
    at('pointerUp', { x: 530, y: 80 });
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-c'))).toMatchObject({ parentId: 'frame-f', x: 120, y: 70, z });
  });

  it('drops nothing and outlines nothing when the drag is cancelled', () => {
    const { controller, changeSets, at } = setUp();
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 460, y: 60 });
    controller.handle({ kind: 'escape' }, 1);
    expect(controller.overlay().dropTarget).toBeUndefined();
    expect(changeSets).toEqual([]);
  });

  it('follows the new frame after a drop: moving it moves the selection frame', () => {
    const { store, controller, drag, notifications } = setUp();
    drag({ x: 10, y: 10 }, { x: 460, y: 60 });
    const before = notifications();
    runCommand(
      store,
      SYSTEM_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: 'frame-f', by: { x: 100, y: 0 } }] },
      ENVIRONMENT,
    );
    expect(notifications()).toBe(before + 1);
    expect(controller.frame()).toMatchObject({ x: 550, y: 50 });
  });

  it('stops following the old frame after a drag out of it', () => {
    const { store, controller, drag, notifications } = setUp();
    drag({ x: 430, y: 30 }, { x: 430, y: 280 });
    const before = notifications();
    runCommand(
      store,
      SYSTEM_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: 'frame-f', by: { x: 100, y: 0 } }] },
      ENVIRONMENT,
    );
    expect(notifications()).toBe(before);
    expect(controller.frame()).toMatchObject({ x: 420, y: 270 });
  });

  it('moves in place, keeping the parent, when the frame cannot stack the object', () => {
    const refusals: (readonly CommandError[])[] = [];
    const { store, changeSets, drag } = setUp((errors) => refusals.push(errors));
    // rect-c, frame-f's only child, now has a key no new key can be placed above.
    writeInvalidKeyRemotely(store, 'rect-c');
    changeSets.length = 0;
    drag({ x: 10, y: 10 }, { x: 460, y: 60 });
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-a'))).toMatchObject({ parentId: null, x: 450, y: 50 });
    expect(refusals.map((errors) => errors.map(({ code, path }) => [code, path]))).toEqual([
      [['unorderable-neighbours', ['moves', 0, 'parentId']]],
    ]);
  });

  it('makes the same plain move with no one listening for refusals', () => {
    const { store, changeSets, drag } = setUp();
    writeInvalidKeyRemotely(store, 'rect-c');
    changeSets.length = 0;
    drag({ x: 10, y: 10 }, { x: 460, y: 60 });
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-a'))).toMatchObject({ parentId: null, x: 450, y: 50 });
  });
});
