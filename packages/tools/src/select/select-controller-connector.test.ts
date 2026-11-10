import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { ObjectId, Point, PrincipalId } from '@canvas/schema';

import { id, indexOf, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectInput } from './select-input.js';
import { selectionFrameOf } from './selection-frame.js';

/** A collaborator's update, as the relay delivers it. */
const REMOTE: TransactionOrigin = { kind: 'system', principalId: 'system' as PrincipalId };

// A selected connector: framed by the route it draws between its targets, which a move
// of a target re-frames; alone and unlocked it follows the line's confirmed rule, no rotate or
// resize controls (its ends are dragged), so a press beside its frame draws a marquee.

const CONNECTOR = id('connector-k');
/** connector-k runs from rect-a's right side (100, 25) to rect-c's left side (420, 45). */
const ROUTE_BOX = { x: 100, y: 25, width: 320, height: 20, rotation: 0 };
/** Just outside the top-right corner of that frame: a rotation band, if the frame had one. */
const OUTSIDE_CORNER = { x: 426, y: 19 };

/**
 * A select tool over the select board with connector-k selected.
 *
 * @param hasLineEndHandles - Whether lines and connectors are edited by their end handles.
 * @returns The tool, the store and a pointer driver.
 */
function withConnectorSelected(hasLineEndHandles: boolean) {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    hasLineEndHandles,
  });
  controller.select([CONNECTOR]);
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    const input: SelectInput = {
      kind,
      screen: point,
      world: point,
      isShiftPressed: false,
      isModPressed: false,
    };
    controller.handle(input, 1);
  };
  return { store, controller, at };
}

describe('SelectController: a selected connector', () => {
  it('is framed and outlined by its route', () => {
    const { controller } = withConnectorSelected(true);
    expect(controller.frame()).toEqual(ROUTE_BOX);
    controller.select([CONNECTOR, id('rect-a')]);
    expect(controller.overlay().outlines).toContainEqual(ROUTE_BOX);
  });

  it('is framed again when a target moves, though the connector is not written', () => {
    const { store, controller } = withConnectorSelected(true);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-a'), { y: 200 });
    });
    // From rect-a's right side (100, 225) to rect-c's left side (420, 45).
    expect(controller.frame()).toEqual({ x: 100, y: 45, width: 320, height: 180, rotation: 0 });
  });

  it('alone, offers no rotation band: a press beside its frame draws a marquee', () => {
    const { store, controller, at } = withConnectorSelected(true);
    const before = store.encodeState();
    at('pointerMove', OUTSIDE_CORNER);
    expect(controller.cursor).toBe('default');
    at('pointerDown', OUTSIDE_CORNER);
    at('pointerMove', { x: 600, y: -100 });
    expect(controller.overlay().marquee).toBeDefined();
    at('pointerUp', { x: 600, y: -100 });
    expect(store.encodeState()).toEqual(before);
  });

  it('keeps the frame’s rotation band without end handles', () => {
    const { controller, at } = withConnectorSelected(false);
    at('pointerMove', OUTSIDE_CORNER);
    expect(controller.cursor).not.toBe('default');
  });

  it('is framed again when an object arrives in a group it is attached to, here or remotely', () => {
    const objects = selectBoardObjects().map((object) =>
      object.id === CONNECTOR
        ? { ...object, to: { kind: 'object' as const, objectId: id('group-h'), anchor: null } }
        : object,
    );
    const store = createSelectStore(objects);
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
      hasLineEndHandles: true,
    });
    controller.select([CONNECTOR]);
    const before = controller.frame();
    const fresh = () => selectionFrameOf([CONNECTOR], storeSource(store));
    // A shape created in the group, by this client: the group's box, and so the route, grows.
    store.transact(ADA, (transaction) => {
      transaction.setObject(rect('rect-local', 'group-h', { x: 100, y: 0, width: 40, height: 40 }));
    });
    expect(fresh()).not.toEqual(before);
    expect(controller.frame()).toEqual(fresh());
    // One created there by a collaborator, arriving as a remote update.
    const peer = new YjsDocumentStore();
    peer.applyUpdate(store.encodeState(), ADA);
    peer.transact(ADA, (transaction) => {
      transaction.setObject(
        rect('rect-remote', 'group-h', { x: 300, y: 0, width: 40, height: 40 }),
      );
    });
    const between = controller.frame();
    store.applyUpdate(peer.encodeState(store.encodeStateVector()), REMOTE);
    expect(fresh()).not.toEqual(between);
    expect(controller.frame()).toEqual(fresh());
  });
});
