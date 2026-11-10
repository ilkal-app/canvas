import { describe, expect, it } from 'vitest';

import { isValidKey, type ObjectId } from '@canvas/schema';

import { ADA, BOB, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createSeededRandom } from '../z-order/__fixtures__/seeded-random.js';
import { createSiblingStore, FRAME_ID } from '../z-order/__fixtures__/sibling-board.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { placeObjectsCommand } from './place-objects.js';
import { bringToFrontCommand } from './reorder.js';
import { runCommand } from './run-command.js';

// Concurrent drops in the layers panel: two editors placing objects at once must
// converge to one order, each drop landing whole, because each moved object's key is its own
// field, generated between its neighbours' keys and tagged with its id.

/** The client id the base board is written with: none of the copies' ids, so Yjs keeps theirs. */
const BASE_CLIENT_ID = 9;

/**
 * A copy of a store's board in a new store with a fixed client id.
 *
 * @param source - The store to copy.
 * @param clientId - The copy's Yjs client id.
 * @returns The copy.
 */
function copyOf(source: YjsDocumentStore, clientId: number): YjsDocumentStore {
  const store = new YjsDocumentStore({ clientId });
  store.applyUpdate(source.encodeState(), RELAY);
  return store;
}

/**
 * Runs `placeObjects` and expects it applied.
 *
 * @param store - The store.
 * @param input - The command's input.
 * @param input.ids - The objects.
 * @param input.parentId - Their parent.
 * @param input.belowId - The sibling they go below.
 * @param origin - Who runs it.
 */
function place(
  store: YjsDocumentStore,
  input: { ids: string[]; parentId: string | null; belowId?: string },
  origin = ADA,
): void {
  const outcome = runCommand(store, origin, placeObjectsCommand, input, testEnvironment());
  expect(outcome.status).toBe('applied');
}

describe('placeObjects under concurrency', () => {
  it('two drops into the same gap both land in it, in one order on both clients', () => {
    for (const [adaId, bobId] of [
      [1, 2],
      [2, 1],
    ] as const) {
      const base = createSiblingStore(6, {}, BASE_CLIENT_ID);
      const ada = copyOf(base, adaId);
      const bob = copyOf(base, bobId);
      place(ada, { ids: ['s0'], parentId: FRAME_ID, belowId: 's4' });
      place(bob, { ids: ['s5'], parentId: FRAME_ID, belowId: 's4' }, BOB);
      exchange(ada, bob);
      const order = sortedSiblings(ada, FRAME_ID);
      expect(sortedSiblings(bob, FRAME_ID)).toEqual(order);
      expect(order.slice(0, 3)).toEqual(['s1', 's2', 's3']);
      expect(order.slice(3, 5).sort()).toEqual(['s0', 's5']);
      expect(order[5]).toBe('s4');
    }
  });

  it('a drop into a frame merges with a concurrent reorder of the frame’s children', () => {
    const base = createNestedFramesStore();
    const ada = copyOf(base, 1);
    const bob = copyOf(base, 2);
    place(ada, { ids: ['rect-free'], parentId: 'frame-inner', belowId: 'rect-inner-2' });
    const outcome = runCommand(
      bob,
      BOB,
      bringToFrontCommand,
      { ids: ['rect-inner'] },
      testEnvironment(),
    );
    expect(outcome.status).toBe('applied');
    exchange(ada, bob);
    const inner = 'frame-inner' as ObjectId;
    expect(sortedSiblings(ada, inner)).toEqual(['rect-free', 'rect-inner-2', 'rect-inner']);
    expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  });

  it('two drops of one object into different parents keep one whole placement', () => {
    const base = createNestedFramesStore();
    const ada = copyOf(base, 1);
    const bob = copyOf(base, 2);
    place(ada, { ids: ['rect-free'], parentId: 'frame-side' });
    place(bob, { ids: ['rect-free'], parentId: 'group-g' }, BOB);
    exchange(ada, bob);
    const placed = ada.get('rect-free' as ObjectId);
    expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
    expect(['frame-side', 'group-g']).toContain(placed?.parentId);
    const siblings = sortedSiblings(ada, placed?.parentId ?? null);
    expect(siblings.at(-1)).toBe('rect-free');
  });

  it('random concurrent drops among a frame’s children converge with valid, distinct keys', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const random = createSeededRandom(seed);
      const base = createSiblingStore(8, {}, BASE_CLIENT_ID);
      const [ada, bob, cara] = [copyOf(base, 1), copyOf(base, 2), copyOf(base, 3)];
      const clients = [ada, bob, cara];
      for (let round = 0; round < 4; round += 1) {
        for (const client of clients) {
          const siblings = sortedSiblings(client, FRAME_ID);
          const ids = random.shuffle(siblings).slice(0, 1 + random.below(3));
          const others = siblings.filter((id) => !ids.includes(id));
          const belowId = random.below(5) === 0 ? undefined : random.pick(others);
          const input = { ids, parentId: FRAME_ID, ...(belowId === undefined ? {} : { belowId }) };
          const outcome = runCommand(client, ADA, placeObjectsCommand, input, testEnvironment());
          expect(outcome.status, `seed ${String(seed)}`).toBe('applied');
        }
        for (const [first, second] of [
          [ada, bob],
          [bob, cara],
          [ada, cara],
        ] as const) {
          exchange(first, second);
        }
      }
      const order = sortedSiblings(ada, FRAME_ID);
      for (const client of clients) expect(sortedSiblings(client, FRAME_ID)).toEqual(order);
      const keys = order.map((id) => ada.get(id)?.z ?? '');
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every((key) => isValidKey(key))).toBe(true);
    }
  });
});
