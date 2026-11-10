// An object whose update arrives before an earlier one it depends on. Yjs applies an
// update's deletions at once but holds its insertions back until the updates they follow
// arrive, so a peer's change of a field (deleting the old value, inserting the new one) used to
// leave the field empty for a while: the object could not be read (`missing-field`), a command on
// an object referring to it was refused (`missing-parent`, `missing-connector-target`), and a move
// inside it was measured in the wrong frame. The store now holds those deletions back while
// structs are pending (`store/held-deletes.ts`): the object reads as it was until the update
// arrives whole. Real updates; Bob is given Ada's second update only.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { createClientPair } from '../history/__fixtures__/history-fixtures.js';
import { BOB, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import type { AnyCommand } from './command.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand, type CommandOutcome } from './run-command.js';

/** Ada's and Bob's stores, Bob holding Ada's second update but not her first. */
interface PartlyDelivered {
  readonly bob: YjsDocumentStore;
  /** Ada's first update, withheld from Bob. */
  readonly withheld: Uint8Array;
}

/**
 * Runs a command by name.
 *
 * @param store - The store.
 * @param name - The command.
 * @param input - Its input.
 * @param seed - The id generator's seed.
 * @returns The outcome.
 */
function run(
  store: YjsDocumentStore,
  name: CommandName,
  input: unknown,
  seed = 23,
): CommandOutcome<unknown> {
  return runCommand(store, BOB, COMMANDS[name] as AnyCommand, input, testEnvironment(seed));
}

/**
 * Ada writes two updates, an unrelated move and then a change to `partlyId` (a move, or a lock
 * where the object cannot be moved); Bob is given the second only, which Yjs cannot integrate
 * before the first (Yjs alone would apply its deletions at once).
 *
 * @param partlyId - The object Bob ends up holding partly.
 * @param setup - What Ada writes, and Bob is given, first.
 * @returns Bob's store and the withheld update.
 * @throws {Error} When Ada's commands did not make two updates.
 */
function partlyDelivered(
  partlyId: string,
  setup?: (ada: YjsDocumentStore) => void,
): PartlyDelivered {
  const [ada, bob] = createClientPair(1, 2);
  if (setup !== undefined) {
    setup(ada);
    exchange(ada, bob);
  }
  const updates: Uint8Array[] = [];
  const stop = ada.subscribeUpdates((update) => {
    if (update.isLocal) updates.push(update.update);
  });
  run(ada, 'moveObjects', { moves: [{ id: 'image-photo', by: { x: 1, y: 1 } }] }, 11);
  const moved = run(ada, 'moveObjects', { moves: [{ id: partlyId, by: { x: 5, y: 5 } }] }, 11);
  if (moved.status === 'rejected') run(ada, 'setLocked', { ids: [partlyId], locked: true }, 11);
  stop();
  const [withheld, delivered] = updates;
  if (withheld === undefined || delivered === undefined) throw new Error('expected two updates');
  bob.applyUpdate(delivered, RELAY);
  return { bob, withheld };
}

const connectInFrame = (ada: YjsDocumentStore): void => {
  run(ada, 'connect', {
    id: 'conn-in-frame',
    parentId: 'frame-plan',
    from: { point: { x: 0, y: 0 } },
    to: { objectId: 'sticky-idea' },
  });
};

describe('an object whose update arrives before the one it follows', () => {
  it('keeps reading as it was while Bob awaits the earlier update', () => {
    const { bob } = partlyDelivered('frame-plan');
    expect(bob.hasPendingStructs).toBe(true);
    expect(bob.read().issues).toEqual([]);
    const [whole] = createClientPair(1, 2);
    expect(bob.get('frame-plan' as ObjectId)).toEqual(whole.get('frame-plan' as ObjectId));
  });

  it('takes the new value once the earlier update arrives, with nothing left held', () => {
    const { bob, withheld } = partlyDelivered('frame-plan');
    bob.applyUpdate(withheld, RELAY);
    const [ada] = createClientPair(1, 2);
    run(ada, 'moveObjects', { moves: [{ id: 'image-photo', by: { x: 1, y: 1 } }] }, 11);
    run(ada, 'moveObjects', { moves: [{ id: 'frame-plan', by: { x: 5, y: 5 } }] }, 11);
    expect(bob.hasPendingStructs).toBe(false);
    expect(bob.read().issues).toEqual([]);
    expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
    expect(Y.decodeUpdate(bob.encodeState()).ds).toEqual(Y.decodeUpdate(ada.encodeState()).ds);
  });

  it('keeps the held deletions in an encoded state, held again by a store that loads it', () => {
    const { bob, withheld } = partlyDelivered('frame-plan');
    const reloaded = new YjsDocumentStore({ clientId: 3 });
    reloaded.applyUpdate(bob.encodeState(), RELAY);
    expect(reloaded.read().issues).toEqual([]);
    expect(reloaded.get('frame-plan' as ObjectId)).toEqual(bob.get('frame-plan' as ObjectId));
    reloaded.applyUpdate(withheld, RELAY);
    bob.applyUpdate(withheld, RELAY);
    expect(reloaded.hasPendingStructs).toBe(false);
    expect(new Map(reloaded.read().objects)).toEqual(new Map(bob.read().objects));
  });

  it('deletes a whole object at once, and sends what it holds, while structs are pending', () => {
    const { bob } = partlyDelivered('frame-plan');
    const [, cara] = createClientPair(1, 3);
    const updates: Uint8Array[] = [];
    cara.subscribeUpdates((update) => updates.push(update.update));
    expect(run(cara, 'deleteObjects', { ids: ['video-demo'] }).status).toBe('applied');
    for (const update of updates) bob.applyUpdate(update, RELAY);
    expect(bob.hasPendingStructs).toBe(true);
    expect(bob.get('video-demo' as ObjectId)).toBeUndefined();
    expect(bob.get('frame-plan' as ObjectId)).toBeDefined();
    const relay = new YjsDocumentStore({ clientId: 4 });
    relay.applyUpdate(bob.encodeSyncState(), RELAY);
    expect(relay.get('video-demo' as ObjectId)).toBeUndefined();
  });

  it('reports a newly held deletion to the update listeners, for the device cache', () => {
    const { bob } = partlyDelivered('frame-plan');
    const [, fresh] = createClientPair(1, 5);
    const reported: Uint8Array[] = [];
    fresh.subscribeUpdates(({ update, isLocal }) => {
      if (!isLocal) reported.push(update);
    });
    fresh.applyUpdate(bob.encodeState(), RELAY);
    expect(fresh.hasPendingStructs).toBe(true);
    const deletesOnly = reported
      .map((update) => Y.decodeUpdate(update))
      .filter(({ structs, ds }) => structs.length === 0 && ds.clients.size > 0);
    expect(deletesOnly).toHaveLength(1);
  });

  it('reports a held deletion to every listener when one throws, then rethrows', () => {
    const { bob } = partlyDelivered('frame-plan');
    const [, fresh] = createClientPair(1, 5);
    const reported: Uint8Array[] = [];
    fresh.subscribeUpdates(() => {
      throw new Error('listener failed');
    });
    fresh.subscribeUpdates(({ update }) => reported.push(update));
    expect(() => {
      fresh.applyUpdate(bob.encodeState(), RELAY);
    }).toThrow('listener failed');
    const deletesOnly = reported
      .map((update) => Y.decodeUpdate(update))
      .filter(({ structs, ds }) => structs.length === 0 && ds.clients.size > 0);
    expect(deletesOnly).toHaveLength(1);
  });

  it.each([
    ['shape-box', 'connector-flow', undefined],
    ['frame-plan', 'conn-in-frame', connectInFrame],
  ] as const)('with %s pending, applies setConnectorEnd on %s', (partlyId, connectorId, setup) => {
    const { bob } = partlyDelivered(partlyId, setup);
    const input = { id: connectorId, end: 'from', target: { point: { x: 1, y: 2 } } };
    expect(run(bob, 'setConnectorEnd', input).status).toBe('applied');
  });

  it('moves a child of a turned group in the group frame while the group is pending', () => {
    const { bob } = partlyDelivered('group-diagram');
    const [whole] = createClientPair(1, 2);
    const move = { moves: [{ id: 'shape-box', by: { x: 10, y: 0 } }] };
    expect(run(bob, 'moveObjects', move).status).toBe('applied');
    expect(run(whole, 'moveObjects', move).status).toBe('applied');
    const moved = bob.get('shape-box' as ObjectId);
    expect(moved?.x).toBeCloseTo(9.689124217106446, 9);
    expect(moved?.y).toBeCloseTo(-2.474039592545239, 9);
    expect([moved?.x, moved?.y]).toEqual([
      whole.get('shape-box' as ObjectId)?.x,
      whole.get('shape-box' as ObjectId)?.y,
    ]);
  });
});
