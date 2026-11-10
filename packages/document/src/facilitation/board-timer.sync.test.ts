import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import {
  setBoardTimerCommand,
  type setBoardTimerInputSchema,
} from '../commands/facilitation/set-board-timer.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { createSyncedPair, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

// The board timer is one plain value under the facilitation map's `timer` key, written
// whole, so concurrent actions converge to one writer's timer in every delivery order, and a
// client that joins later reads the same timer.

const T0 = 1_770_000_000_000;

/** A timer action as the command takes it. */
type TimerActionInput = z.input<typeof setBoardTimerInputSchema>['action'];

/**
 * Runs a timer action as a person's client does: under the system origin, naming them.
 *
 * @param store - Their store.
 * @param who - Who acts.
 * @param action - The action.
 * @param serverNowMs - The moment by the relay's clock.
 */
function act(
  store: YjsDocumentStore,
  who: string,
  action: TimerActionInput,
  serverNowMs: number,
): void {
  const input = { action, serverNowMs, actor: who as PrincipalId };
  applyCommand(store, setBoardTimerCommand, input, SYSTEM_ORIGIN);
}

/**
 * Two synced clients that run concurrent actions, and the four boards they lead to: each
 * client after receiving the other's update, and fresh copies of the base that receive both
 * updates in each order.
 *
 * @param setUp - Actions on Ada's client before the two diverge.
 * @param ada - Ada's concurrent actions.
 * @param bob - Bob's concurrent actions.
 * @returns The four boards.
 */
function converge(
  setUp: (store: YjsDocumentStore) => void,
  ada: (store: YjsDocumentStore) => void,
  bob: (store: YjsDocumentStore) => void,
): YjsDocumentStore[] {
  const [first, second] = createSyncedPair();
  setUp(first);
  second.applyUpdate(first.encodeState(second.encodeStateVector()), RELAY);
  const base = first.encodeState();
  const fromAda: Uint8Array[] = [];
  const fromBob: Uint8Array[] = [];
  first.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) fromAda.push(update);
  });
  second.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) fromBob.push(update);
  });
  ada(first);
  bob(second);
  const orders = [
    [...fromAda, ...fromBob],
    [...fromBob, ...fromAda],
  ].map((updates) => {
    const copy = new YjsDocumentStore();
    copy.applyUpdate(base, RELAY);
    for (const update of updates) copy.applyUpdate(update, RELAY);
    return copy;
  });
  for (const update of fromBob) first.applyUpdate(update, RELAY);
  for (const update of fromAda) second.applyUpdate(update, RELAY);
  return [first, second, ...orders];
}

/**
 * Expects every board to read the same timer, and returns it.
 *
 * @param boards - The boards.
 * @returns The timer they share.
 */
function sameTimer(boards: readonly YjsDocumentStore[]) {
  const [first, ...rest] = boards.map((board) => board.boardTimer.current);
  for (const timer of rest) expect(timer).toEqual(first);
  return first;
}

describe('board timer sync', () => {
  const running = (store: YjsDocumentStore) => {
    act(store, 'user:ada', { kind: 'start', durationMs: 60_000 }, T0);
  };

  it('converges when two people pause at once, to one of their pauses', () => {
    const boards = converge(
      running,
      (store) => {
        act(store, 'user:ada', { kind: 'pause' }, T0 + 10_000);
      },
      (store) => {
        act(store, 'user:bob', { kind: 'pause' }, T0 + 10_200);
      },
    );
    const timer = sameTimer(boards);
    expect(timer?.status).toBe('paused');
    expect([50_000, 49_800]).toContain(timer?.status === 'paused' ? timer.remainingMs : 0);
  });

  it('converges when one person resumes while another resets', () => {
    const paused = (store: YjsDocumentStore) => {
      running(store);
      act(store, 'user:ada', { kind: 'pause' }, T0 + 10_000);
    };
    const timer = sameTimer(
      converge(
        paused,
        (store) => {
          act(store, 'user:ada', { kind: 'resume' }, T0 + 20_000);
        },
        (store) => {
          act(store, 'user:bob', { kind: 'reset' }, T0 + 20_000);
        },
      ),
    );
    expect(['running', 'idle']).toContain(timer?.status);
  });

  it('converges when pauses and resumes interleave on both sides', () => {
    const timer = sameTimer(
      converge(
        running,
        (store) => {
          act(store, 'user:ada', { kind: 'pause' }, T0 + 1000);
          act(store, 'user:ada', { kind: 'resume' }, T0 + 2000);
        },
        (store) => {
          act(store, 'user:bob', { kind: 'pause' }, T0 + 1500);
          act(store, 'user:bob', { kind: 'end' }, T0 + 1600);
        },
      ),
    );
    expect(timer === undefined || timer.status === 'running').toBe(true);
  });

  it('shows a client that joins later the timer and its time left', () => {
    const [ada] = createSyncedPair();
    running(ada);
    act(ada, 'user:ada', { kind: 'pause' }, T0 + 12_345);
    const late = new YjsDocumentStore();
    late.applyUpdate(ada.encodeState(), RELAY);
    expect(late.boardTimer.current).toEqual(ada.boardTimer.current);
    expect(late.boardTimer.current).toMatchObject({ status: 'paused', remainingMs: 47_655 });
  });
});
