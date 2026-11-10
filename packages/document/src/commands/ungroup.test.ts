import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  isValidKey,
  objectToBoardTransform,
  parentToBoardTransform,
  type BoardObject,
} from '@canvas/schema';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { objectKeyTag } from '../z-order/object-keys.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { boardPlacement, expectSamePlacement } from './__fixtures__/board-geometry.js';
import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { createObjectCommand } from './create-object.js';
import { groupCommand } from './group.js';
import { setStyleCommand } from './set-style.js';
import { ungroupCommand } from './ungroup.js';

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 9);
};

/** A comment inside the fixture's group, pinned to the group itself. */
const PINNED_COMMENT = {
  type: 'comment',
  id: 'comment-group',
  parentId: 'group-diagram',
  x: 5,
  y: 5,
  threadId: 'thread-group',
  anchor: { kind: 'object', objectId: 'group-diagram', offset: { x: 10, y: 20 } },
} as const;

describe('ungroup', () => {
  it("moves a group's children to its parent where they are, and deletes the group", () => {
    const store = createFixtureStore();
    const before = store.read();
    const placements = ['shape-box', 'shape-star'].map((key) => boardPlacement(before, key));
    const { result, changes } = applyCommand(store, ungroupCommand, { ids: ['group-diagram'] });
    expect(result).toEqual({ releasedIds: ['shape-box', 'shape-star'] });
    expectDiff(before, store.read(), changes, {
      deleted: ['group-diagram'],
      updated: ['shape-box', 'shape-star'],
    });
    expect(mustGet(store, 'shape-box')).toMatchObject({
      parentId: 'frame-plan',
      x: 400,
      y: 120,
      rotation: 0.25,
      z: `a3${objectKeyTag(id('shape-box'))}`,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'shape-star')).toMatchObject({
      parentId: 'frame-plan',
      z: `a4${objectKeyTag(id('shape-star'))}`,
    });
    ['shape-box', 'shape-star'].forEach((key, index) => {
      const placement = placements[index];
      if (placement !== undefined) {
        expectSamePlacement(boardPlacement(store.read(), key), placement, closeTo);
      }
    });
  });

  it('keeps the children below the sibling that was above the group', () => {
    const store = createFixtureStore();
    const sticky = fixtureObject('sticky-idea', 'sticky');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...sticky, id: id('sticky-top'), z: 'a2V' });
    });
    applyCommand(store, ungroupCommand, { ids: ['group-diagram'] });
    const keys = ['shape-box', 'shape-star'].map((key) => mustGet(store, key).z);
    expect(keys.every((key) => key > 'a2' && key < 'a2V')).toBe(true);
    expect((keys[0] ?? '') < (keys[1] ?? '')).toBe(true);
  });

  it('puts the children on top when the group key is not a fractional-index key', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'group-diagram': 'A' });
    applyCommand(store, ungroupCommand, { ids: ['group-diagram'] });
    expect(sortedSiblings(store, id('frame-plan')).slice(-2)).toEqual(['shape-box', 'shape-star']);
  });

  it('refuses without writing when neither the group key nor the top key can be used', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'group-diagram': 'legacy' });
    const errors = expectRejected(store, ungroupCommand, { ids: ['group-diagram'] });
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'unorderable-neighbours',
        objectId: 'group-diagram',
        path: ['ids', 0],
      }),
    ]);
  });

  it('detaches connectors and comments attached to the group where they were', () => {
    const store = createFixtureStore();
    const connector = {
      ...fixtureObject('connector-flow', 'connector'),
      id: id('connector-group'),
    };
    store.transact(ADA, (transaction) => {
      transaction.setObject({
        ...connector,
        to: { kind: 'object', objectId: id('group-diagram'), anchor: { x: 0, y: 0 } },
      });
    });
    applyCommand(store, createObjectCommand, { object: PINNED_COMMENT });
    const before = store.read();
    const pinBefore = applyTransform(
      objectToBoardTransform(before, mustGet(store, 'group-diagram')),
      PINNED_COMMENT.anchor.offset,
    );
    const { changes } = applyCommand(store, ungroupCommand, { ids: ['group-diagram'] });
    expectDiff(before, store.read(), changes, {
      deleted: ['group-diagram'],
      updated: ['comment-group', 'connector-group', 'shape-box', 'shape-star'],
    });
    expect(mustGet(store, 'connector-group')).toMatchObject({
      to: { kind: 'point' },
      updatedAt: NOW,
    });
    const comment: BoardObject = mustGet(store, 'comment-group');
    expect(comment).toMatchObject({ parentId: 'frame-plan', anchor: { kind: 'point' } });
    const pinAfter = applyTransform(parentToBoardTransform(store.read(), comment), comment);
    closeTo(pinAfter.x, pinBefore.x);
    closeTo(pinAfter.y, pinBefore.y);
  });

  it('rejects objects that are not groups, missing ids and nested groups listed together', () => {
    const store = createFixtureStore();
    applyCommand(store, groupCommand, { ids: ['group-diagram'], groupId: 'group-outer' });
    const errors = expectRejected(store, ungroupCommand, {
      ids: ['group-outer', 'group-diagram', 'sticky-idea', 'gone'],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['ids', 3]],
      ['overlapping-selection', 'group-diagram', ['ids', 1]],
      ['unsupported-type', 'sticky-idea', ['ids', 2]],
    ]);
  });

  it('rejects a group whose attached connector cannot be placed because of a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('connector-flow'), {
        to: { kind: 'object', objectId: id('loop-a'), anchor: null },
      });
    });
    expect(refusalsOn(storedBoardOf(store), ungroupCommand, { ids: ['loop-a'] })).toEqual([
      expect.objectContaining({ code: 'parent-cycle' }),
    ]);
  });

  it('converges when one client ungroups while another restyles a child', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, ungroupCommand, { ids: ['group-diagram'] });
    applyCommand(
      bob,
      setStyleCommand,
      { changes: [{ id: 'shape-box', style: { fill: [1, 0, 0, 1] } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.get(id('shape-box'))).toMatchObject({ parentId: 'frame-plan', fill: [1, 0, 0, 1] });
    expect(bob.get(id('group-diagram'))).toBeUndefined();
  });

  it.each([
    ['different keys', false],
    ['the same key', true],
  ])(
    'gives the children of two sibling groups with %s, ungrouped together, distinct keys',
    (label, isSameKey) => {
      const store = new YjsDocumentStore({ clientId: 3 });
      const create = (object: Record<string, unknown>) =>
        applyCommand(store, createObjectCommand, {
          object: { type: 'group', x: 0, y: 0, ...object },
        });
      create({ id: 'g1' });
      create({ id: 'g2', ...(isSameKey ? { z: mustGet(store, 'g1').z } : {}) });
      for (const group of ['g1', 'g2']) {
        for (const child of ['c0', 'c1', 'c2'])
          create({ id: `${group}-${child}`, parentId: group });
      }
      applyCommand(store, ungroupCommand, { ids: ['g1', 'g2'] });
      const order = sortedSiblings(store, null);
      const keys = order.map((objectId) => mustGet(store, objectId).z);
      expect(order, label).toHaveLength(6);
      expect(new Set(keys).size).toBe(6);
      for (const key of keys) expect(isValidKey(key)).toBe(true);
      // Each group's children keep their order; groups with distinct keys keep theirs too.
      for (const group of ['g1', 'g2']) {
        expect(order.filter((objectId) => objectId.startsWith(group))).toEqual(
          ['c0', 'c1', 'c2'].map((child) => `${group}-${child}`),
        );
      }
      if (!isSameKey)
        expect(order.slice(0, 3).every((objectId) => objectId.startsWith('g1'))).toBe(true);
    },
  );
});
