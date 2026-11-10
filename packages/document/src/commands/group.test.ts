import { describe, expect, it } from 'vitest';

import { isValidKey } from '@canvas/schema';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import {
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import { boardPlacement, expectSamePlacement } from './__fixtures__/board-geometry.js';
import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { groupCommand } from './group.js';
import { moveObjectsCommand } from './move-objects.js';
import { bringForwardCommand } from './reorder.js';

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 9);
};

describe('group', () => {
  it('groups objects at the top-left of their bounds, where the topmost one was stacked', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, groupCommand, {
      ids: ['video-demo', 'image-photo'],
    });
    expectDiff(before, store.read(), changes, {
      created: [result.groupId],
      updated: ['image-photo', 'video-demo'],
    });
    expect(mustGet(store, result.groupId)).toEqual({
      id: result.groupId,
      type: 'group',
      parentId: null,
      pageId: 'page-1',
      x: 900,
      y: -300,
      rotation: 0,
      // Between the topmost member's key (`a2`) and the next sibling's (`a3`), ending in the
      // group's tag (`0eFpg`).
      z: 'a2V0eFpg',
      locked: false,
      createdBy: 'user:ada',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'image-photo')).toEqual({
      ...fixtureObject('image-photo', 'image'),
      parentId: result.groupId,
      pageId: null,
      x: 0,
      y: 0,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'video-demo')).toMatchObject({ parentId: result.groupId, x: 0, y: 400 });
  });

  it("keeps every member, and a nested group's children, where they are on the board", () => {
    const store = createFixtureStore();
    const tracked = ['group-diagram', 'shape-box', 'shape-star', 'sticky-idea'];
    const before = tracked.map((objectId) => boardPlacement(store.read(), objectId));
    const { result } = applyCommand(store, groupCommand, {
      ids: ['group-diagram', 'sticky-idea'],
      groupId: 'group-new',
    });
    expect(result).toEqual({ groupId: 'group-new' });
    // `group-diagram` (`a2`) was the frame's top child, so the group goes above it.
    expect(mustGet(store, 'group-new')).toMatchObject({ parentId: 'frame-plan', z: 'a30FKyJ' });
    tracked.forEach((objectId, index) => {
      const placement = before[index];
      if (placement !== undefined) {
        expectSamePlacement(boardPlacement(store.read(), objectId), placement, closeTo);
      }
    });
    // The sticky is the leftmost and topmost member.
    expect(mustGet(store, 'group-new')).toMatchObject({ x: 40, y: 120 });
  });

  it("uses the members' origins when none of them has bounds of its own", () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, groupCommand, {
      ids: ['comment-free', 'connector-flow'],
    });
    expect(mustGet(store, result.groupId)).toMatchObject({ x: 0, y: 0 });
    expect(mustGet(store, 'comment-free')).toMatchObject({ x: 1000, y: 800 });
  });

  it("stacks the group on top of its parent when the topmost member's key is not a key", () => {
    const store = createFixtureStore();
    // `a10` ends in `0`: not a fractional-index key, so there is no gap above it to use.
    writeKeysRemotely(store, { 'image-photo': 'a10' });
    const { result } = applyCommand(store, groupCommand, { ids: ['image-photo'] });
    const { z } = mustGet(store, result.groupId);
    expect(isValidKey(z)).toBe(true);
    expect(z > mustGet(store, 'comment-free').z).toBe(true);
  });

  it('refuses when neither the gap above the topmost member nor the top can take a key', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'comment-free': 'legacy' });
    const errors = expectRejected(store, groupCommand, { ids: ['comment-free'] });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'unorderable-neighbours', path: ['ids'] }),
    ]);
  });

  it('nests groups to any depth, and never puts a group inside itself', () => {
    const store = createFixtureStore();
    let inner = 'image-photo';
    for (const level of [1, 2, 3, 4]) {
      const groupId = `group-level-${String(level)}`;
      applyCommand(store, groupCommand, { ids: [inner], groupId });
      expect(mustGet(store, inner).parentId).toBe(groupId);
      inner = groupId;
    }
    expect(store.read().issues).toEqual([]);
    // A group listed with its own child: they have different parents, so it is refused
    // (`mixed-parents`), and no command can make a group its own ancestor.
    const cycle = expectRejected(store, groupCommand, { ids: ['group-level-4', 'group-level-3'] });
    expect(cycle).toEqual([expect.objectContaining({ code: 'mixed-parents' })]);
  });

  it('rejects objects with different parents, and ids that are missing, repeated or taken', () => {
    const store = createFixtureStore();
    const mixed = expectRejected(store, groupCommand, { ids: ['image-photo', 'sticky-idea'] });
    expect(mixed).toEqual([expect.objectContaining({ code: 'mixed-parents', path: ['ids'] })]);
    const errors = expectRejected(store, groupCommand, {
      ids: ['image-photo', 'gone', 'image-photo'],
      groupId: 'frame-plan',
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['ids', 1]],
      ['duplicate-id', 'image-photo', ['ids', 2]],
      ['duplicate-id', 'frame-plan', ['groupId']],
    ]);
    expect(expectRejected(store, groupCommand, { ids: [] })[0]?.code).toBe('invalid-input');
  });

  it('converges when one client groups objects while another moves one of them', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, groupCommand, { ids: ['image-photo', 'video-demo'], groupId: 'group-media' });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'line-divider', by: { x: 0, y: 10 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.get(id('image-photo'))).toMatchObject({ parentId: 'group-media' });
    expect(ada.get(id('line-divider'))).toMatchObject({ y: 710 });
  });
  it('gives two groups made concurrently from the same topmost member distinct keys', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, groupCommand, { ids: ['image-photo', 'video-demo'], groupId: 'group-ada' });
    applyCommand(bob, groupCommand, { ids: ['video-demo'], groupId: 'group-bob' }, BOB);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    // Both groups sit where their topmost member was: above `video-demo`'s key, below the next.
    for (const groupId of ['group-ada', 'group-bob']) {
      const { z } = mustGet(ada, groupId);
      expect(isValidKey(z)).toBe(true);
      expect(z > 'a2' && z < 'a3').toBe(true);
    }
    // Moving the object below them forward lands between the two groups: that needs a gap.
    applyCommand(ada, bringForwardCommand, { ids: ['frame-plan'] });
    exchange(ada, bob);
    expect(bob.read().objects).toEqual(ada.read().objects);
    const keys = [...ada.read().objects.values()]
      .filter((object) => object.parentId === null)
      .map((object) => object.z);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives two groups made concurrently from overlapping selections distinct keys', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, groupCommand, { ids: ['frame-plan', 'line-divider'], groupId: 'group-ada' });
    applyCommand(
      bob,
      groupCommand,
      { ids: ['video-demo', 'line-divider'], groupId: 'group-bob' },
      BOB,
    );
    exchange(ada, bob);
    // `image-photo` is directly below both groups: moving it forward puts it between them.
    applyCommand(bob, bringForwardCommand, { ids: ['image-photo'] }, BOB);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const [lower, upper] = ['group-ada', 'group-bob'].map((groupId) => mustGet(bob, groupId).z);
    expect(lower).not.toBe(upper);
  });
});
