import { describe, expect, it, vi } from 'vitest';

import { ADA, createSyncedPair, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createSiblingStore, FRAME_ID, objectId } from '../z-order/__fixtures__/sibling-board.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import {
  bringForwardCommand,
  bringToFrontCommand,
  sendBackwardCommand,
  sendToBackCommand,
} from './reorder.js';
import { runCommand } from './run-command.js';

describe('the reorder commands', () => {
  it('bring to front writes only the moved objects z, and runCommand stamps updatedAt', () => {
    const store = createSiblingStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, bringToFrontCommand, { ids: ['s1', 's3'] });
    expectDiff(before, store.read(), changes, { updated: ['s1', 's3'] });
    expect(result).toEqual({ movedIds: ['s1', 's3'] });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's2', 's4', 's5', 's1', 's3']);
    const s1 = mustGet(store, 's1');
    expect(s1.updatedAt).toBe(NOW);
    expect({ ...s1, z: 'a1', updatedAt: 0 }).toEqual(before.objects.get(objectId('s1')));
  });

  it('send to back, bring forward and send backward move as the plan says', () => {
    const store = createSiblingStore();
    applyCommand(store, sendToBackCommand, { ids: ['s4'] });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s4', 's0', 's1', 's2', 's3', 's5']);
    applyCommand(store, bringForwardCommand, { ids: ['s4'] });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's4', 's1', 's2', 's3', 's5']);
    applyCommand(store, sendBackwardCommand, { ids: ['s5'] });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's4', 's1', 's2', 's5', 's3']);
  });

  it('reorders children of the board root', () => {
    const store = createSiblingStore();
    applyCommand(store, sendToBackCommand, { ids: ['r1'] });
    expect(sortedSiblings(store, null)).toEqual(['r1', 'frame', 'r0']);
  });

  it('writes nothing when the objects are already in place', () => {
    const store = createSiblingStore();
    const updates = vi.fn();
    store.subscribeUpdates(updates);
    const { result, changes } = applyCommand(store, bringToFrontCommand, { ids: ['s5'] });
    expect(result).toEqual({ movedIds: [] });
    expect(changes.updated).toEqual([]);
    expect(updates).not.toHaveBeenCalled();
  });

  it('converges when two clients reorder concurrently (sync)', () => {
    const [ada, bob] = createSyncedPair();
    const siblings = sortedSiblings(ada, null);
    const [bottom = '', top = ''] = [siblings[0], siblings.at(-1)];
    applyCommand(ada, bringToFrontCommand, { ids: [bottom] });
    applyCommand(bob, sendToBackCommand, { ids: [top] });
    exchange(ada, bob);
    expect(sortedSiblings(bob, null)).toEqual(sortedSiblings(ada, null));
    expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  });
});

describe('the growth bound on the command path', () => {
  it('swaps two layers under a fixed one 2,525 times before refusing key-too-long', () => {
    // s0 and s1 take turns hopping over each other under s2: each move lands a key between the
    // other's key and s2's, the worst case of the README's growth bound. Keys reach 512
    // characters after 2 + ceil(n / 5) + 5 > 512, that is after 2,525 moves; the command then
    // refuses instead of writing an oversized key.
    const store = createSiblingStore(3);
    const environment = testEnvironment();
    let applied = 0;
    for (;;) {
      const [lowest] = sortedSiblings(store, FRAME_ID);
      const outcome = runCommand(
        store,
        ADA,
        bringForwardCommand,
        { ids: [lowest ?? objectId('s0')] },
        environment,
      );
      if (outcome.status !== 'applied') {
        expect(outcome.errors.map((error) => error.code)).toEqual(['key-too-long']);
        break;
      }
      applied += 1;
    }
    expect(applied).toBeGreaterThanOrEqual(2_525);
    expect(sortedSiblings(store, FRAME_ID).at(-1)).toBe('s2');
  }, 30_000);
});

describe('validate first: a rejected reorder writes nothing', () => {
  it.each([
    ['a missing object', { ids: ['s0', 'ghost'] }, [['missing-object', 'ghost', ['ids', 1]]]],
    ['an id listed twice', { ids: ['s0', 's0'] }, [['duplicate-id', 's0', ['ids', 1]]]],
    [
      'objects of two parents',
      { ids: ['s0', 'r0'] },
      [
        ['mixed-parents', 's0', ['ids', 0]],
        ['mixed-parents', 'r0', ['ids', 1]],
      ],
    ],
  ])('refuses %s', (label, input, expected) => {
    const errors = expectRejected(createSiblingStore(), bringToFrontCommand, input);
    expect(
      errors.map(({ code, objectId: id, path }) => [code, id, path]),
      label,
    ).toEqual(expected);
  });

  it('refuses neighbours whose keys are not fractional-index keys', () => {
    const errors = expectRejected(createSiblingStore(3, { 2: 'legacy' }), bringToFrontCommand, {
      ids: ['s0'],
    });
    expect(errors.map((error) => error.code)).toEqual(['unorderable-neighbours']);
  });

  it.each([
    ['no ids', { ids: [] }],
    ['a malformed id', { ids: ['not an id'] }],
    ['an unknown field', { ids: ['s0'], parentId: 'frame' }],
    ['no input', undefined],
  ])('rejects input with %s before validating', (label, input) => {
    const errors = expectRejected(new YjsDocumentStore(), sendBackwardCommand, input);
    expect(new Set(errors.map((error) => error.code)), label).toEqual(new Set(['invalid-input']));
  });
});
