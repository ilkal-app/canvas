import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setBoardTimerCommand } from '../commands/facilitation/set-board-timer.js';
import { createHistory } from '../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { ADA, createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

const T0 = 1_770_000_000_000;
const ADA_ID = 'user:ada' as PrincipalId;

/**
 * Applies one timer action at a fixed moment on the relay's clock.
 *
 * @param store - The board to change.
 * @param action - The requested action.
 * @param at - The relay time in milliseconds.
 */
function act(
  store: YjsDocumentStore,
  action:
    | { kind: 'start'; durationMs: number }
    | { kind: 'pause' }
    | { kind: 'resume' }
    | { kind: 'reset' },
  at: number,
): void {
  applyCommand(
    store,
    setBoardTimerCommand,
    { action, serverNowMs: at, actor: ADA_ID },
    SYSTEM_ORIGIN,
  );
}

describe('shared timer acceptance: history and convergence', () => {
  it('keeps timer actions out of undo and redo around an object edit', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    act(store, { kind: 'start', durationMs: 60_000 }, T0);
    act(store, { kind: 'pause' }, T0 + 10_000);
    expect(history.canUndo()).toBe(false);
    const object = [...store.read().objects.values()][0];
    if (object === undefined) throw new Error('fixture needs an object');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...object, x: object.x + 10 });
    });
    history.stopCapturing();
    act(store, { kind: 'resume' }, T0 + 20_000);
    const timer = store.boardTimer.current;
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(store.boardTimer.current).toEqual(timer);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(store.boardTimer.current).toEqual(timer);
    act(store, { kind: 'reset' }, T0 + 30_000);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(store.boardTimer.current?.status).toBe('idle');
    history.destroy();
  });

  it('converges three concurrent pause/resume histories in every delivery order and re-exchange', () => {
    const base = createFixtureStore();
    act(base, { kind: 'start', durationMs: 60_000 }, T0);
    const peers = Array.from({ length: 3 }, () => {
      const peer = new YjsDocumentStore();
      peer.applyUpdate(base.encodeState(), RELAY);
      return peer;
    });
    const actions = [
      [{ kind: 'pause' }, { kind: 'resume' }],
      [{ kind: 'pause' }],
      [{ kind: 'pause' }, { kind: 'resume' }, { kind: 'pause' }],
    ] as const;
    const updates = peers.map((peer, index) => {
      const before = peer.encodeStateVector();
      for (const [step, action] of (actions[index] ?? []).entries())
        act(peer, action, T0 + 1000 + index * 100 + step * 1000);
      return peer.encodeState(before);
    });
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const replicas = orders.map((order) => {
      const copy = new YjsDocumentStore();
      copy.applyUpdate(base.encodeState(), RELAY);
      for (const index of order) copy.applyUpdate(updates[index] ?? new Uint8Array(), RELAY);
      return copy;
    });
    for (const peer of peers) {
      for (const update of updates) peer.applyUpdate(update, RELAY);
      replicas.push(peer);
    }
    const expected = replicas[0]?.boardTimer.current;
    for (const replica of replicas) {
      expect(replica.boardTimer.current).toEqual(expected);
      const cold = new YjsDocumentStore();
      cold.applyUpdate(replica.encodeState(), RELAY);
      expect(cold.boardTimer.current).toEqual(expected);
      for (const update of updates) cold.applyUpdate(update, RELAY);
      expect(cold.boardTimer.current).toEqual(expected);
    }
  });
});
