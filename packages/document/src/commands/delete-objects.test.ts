import { describe, expect, it } from 'vitest';

import { cascadeDelete, type BoardObject, type ConnectorDeletePolicy } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { deleteObjectsCommand } from './delete-objects.js';

/** Everything inside the fixture's frame, with the frame. */
const FRAME_SUBTREE = [
  'frame-plan',
  'group-diagram',
  'shape-box',
  'shape-star',
  'sticky-idea',
  'text-title',
];

describe('deleteObjects', () => {
  it('deletes a frame with its descendants and detaches the connector attached inside it', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, deleteObjectsCommand, {
      ids: ['frame-plan'],
    });
    expectDiff(before, store.read(), changes, {
      deleted: FRAME_SUBTREE,
      updated: ['connector-flow'],
    });
    expect(result).toEqual({ deletedIds: FRAME_SUBTREE, updatedIds: ['connector-flow'] });
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      from: { kind: 'point' },
      to: { kind: 'point' },
      updatedAt: NOW,
    });
  });

  it.each<[string[], ConnectorDeletePolicy]>([
    [['frame-plan'], 'detach'],
    [['frame-plan'], 'delete'],
    [['group-diagram', 'image-photo'], 'detach'],
    [['sticky-idea', 'shape-box'], 'delete'],
    [['shape-box', 'group-diagram'], 'detach'],
  ])(
    'leaves the board exactly as the schema rule on the whole board would (%j, %s)',
    (ids, connectorPolicy) => {
      const store = createFixtureStore();
      const before = store.read();
      const expected = cascadeDelete(before, ids.map(id), { connectorPolicy });
      applyCommand(store, deleteObjectsCommand, { ids, connectorPolicy });
      const updated = new Set<string>(expected.updatedIds);
      const stamped = [...expected.board.objects.values()].map((object): BoardObject =>
        updated.has(object.id) ? { ...object, updatedAt: NOW } : object,
      );
      expect(new Map(store.read().objects)).toEqual(
        new Map(stamped.map((object) => [object.id, object])),
      );
    },
  );

  it('deletes attached connectors under the delete policy', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { changes } = applyCommand(store, deleteObjectsCommand, {
      ids: ['sticky-idea'],
      connectorPolicy: 'delete',
    });
    expectDiff(before, store.read(), changes, { deleted: ['connector-flow', 'sticky-idea'] });
  });

  it.each<ConnectorDeletePolicy>(['detach', 'delete'])(
    'restores the target and its connector as they were in one undo (%s)',
    (connectorPolicy) => {
      const store = createFixtureStore();
      const history = createHistory(store, ADA_ID);
      const before = new Map(store.read().objects);
      applyCommand(store, deleteObjectsCommand, { ids: ['shape-box'], connectorPolicy });
      const connector = store.get(id('connector-flow'));
      if (connectorPolicy === 'delete') expect(connector).toBeUndefined();
      else expect(connector).toMatchObject({ to: { kind: 'point' } });
      expect(history.undo()).toBe(true);
      expect(new Map(store.read().objects)).toEqual(before);
      expect(history.canUndo()).toBe(false);
    },
  );

  it('turns a comment pinned to a deleted object into a point pin where it was', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { changes } = applyCommand(store, deleteObjectsCommand, { ids: ['image-photo'] });
    expectDiff(before, store.read(), changes, {
      deleted: ['image-photo'],
      updated: ['comment-on-photo'],
    });
    // The pin sat at offset (380, 20) on the image at (900, -300).
    expect(mustGet(store, 'comment-on-photo')).toMatchObject({
      anchor: { kind: 'point' },
      x: 1280,
      y: -280,
      updatedAt: NOW,
    });
  });

  it('rejects missing and repeated ids without writing', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, deleteObjectsCommand, {
      ids: ['image-photo', 'gone', 'image-photo'],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['ids', 1]],
      ['duplicate-id', 'image-photo', ['ids', 2]],
    ]);
    expect(expectRejected(store, deleteObjectsCommand, { ids: [] })[0]?.code).toBe('invalid-input');
    expect(
      expectRejected(store, deleteObjectsCommand, { ids: ['image-photo'], connectorPolicy: 'x' })[0]
        ?.code,
    ).toBe('invalid-input');
  });

  it('rejects a deletion whose detached connector end sits on a parent cycle', () => {
    const store = createFixtureStore();
    // Two groups parented to each other: a state only concurrent reparenting can produce.
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('connector-flow'), {
        to: { kind: 'object', objectId: id('loop-a'), anchor: null },
      });
    });
    expect(refusalsOn(storedBoardOf(store), deleteObjectsCommand, { ids: ['loop-a'] })).toEqual([
      expect.objectContaining({ code: 'parent-cycle' }),
    ]);
  });

  it('converges when one client deletes a frame while another edits outside it', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, deleteObjectsCommand, { ids: ['frame-plan'] });
    applyCommand(bob, deleteObjectsCommand, { ids: ['comment-free'] }, BOB);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.read().objects.size).toBe(15 - FRAME_SUBTREE.length - 1);
  });
});
