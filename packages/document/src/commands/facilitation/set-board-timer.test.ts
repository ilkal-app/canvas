import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { z } from 'zod';

import type { PrincipalId } from '@canvas/schema';

import { BOARD_TIMER_KEY, FACILITATION_MAP_NAME } from '../../facilitation/timer-map.js';
import { createHistory } from '../../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../../origin/transaction-origin.js';
import { ADA, createFixtureStore, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../../store/internal.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { applyCommand, expectRejected } from '../__fixtures__/command-fixtures.js';
import { batchCommand } from '../batch-command.js';

import { setBoardTimerCommand, type setBoardTimerInputSchema } from './set-board-timer.js';

/** A timer action as the command takes it. */
type TimerActionInput = z.input<typeof setBoardTimerInputSchema>['action'];

const T0 = 1_770_000_000_000;
const ADA_ID = 'user:ada' as PrincipalId;

/**
 * Runs a timer action as Ada's client does: under the system origin, naming Ada.
 *
 * @param store - The store.
 * @param action - The action.
 * @param serverNowMs - The moment, by the relay's clock.
 * @returns The command's result.
 */
function act(store: YjsDocumentStore, action: TimerActionInput, serverNowMs: number) {
  const input = { action, serverNowMs, actor: ADA_ID };
  return applyCommand(store, setBoardTimerCommand, input, SYSTEM_ORIGIN).result;
}

describe('setBoardTimer', () => {
  it('starts, pauses, resumes and resets the board timer by the relay clock', () => {
    const store = createFixtureStore();
    expect(store.boardTimer.current).toBeUndefined();
    act(store, { kind: 'start', durationMs: 60_000 }, T0);
    expect(store.boardTimer.current).toEqual({
      status: 'running',
      durationMs: 60_000,
      remainingMs: 60_000,
      startedAt: T0,
      sectionId: null,
      updatedBy: ADA_ID,
    });
    act(store, { kind: 'pause' }, T0 + 15_000);
    expect(store.boardTimer.current).toMatchObject({ status: 'paused', remainingMs: 45_000 });
    act(store, { kind: 'resume' }, T0 + 100_000);
    expect(store.boardTimer.current).toMatchObject({
      status: 'running',
      remainingMs: 45_000,
      startedAt: T0 + 100_000,
    });
    act(store, { kind: 'reset' }, T0 + 101_000);
    expect(store.boardTimer.current).toMatchObject({ status: 'idle', durationMs: 60_000 });
    act(store, { kind: 'set-duration', durationMs: 120_000 }, T0);
    expect(store.boardTimer.current).toMatchObject({ status: 'idle', durationMs: 120_000 });
    act(store, { kind: 'end' }, T0);
    expect(store.boardTimer.current).toBeUndefined();
  });

  it('records the origin principal outside the system origin, and the actor within it', () => {
    const store = createFixtureStore();
    const input = { action: { kind: 'start', durationMs: 1000 }, serverNowMs: T0 } as const;
    applyCommand(store, setBoardTimerCommand, input, ADA);
    expect(store.boardTimer.current?.updatedBy).toBe(ADA_ID);
    applyCommand(store, setBoardTimerCommand, { ...input, actor: 'user:eve' }, ADA);
    expect(store.boardTimer.current?.updatedBy).toBe(ADA_ID);
    applyCommand(store, setBoardTimerCommand, input, SYSTEM_ORIGIN);
    expect(store.boardTimer.current?.updatedBy).toBe('system');
  });

  it('writes nothing for an action that does not apply', () => {
    const store = createFixtureStore();
    let updates = 0;
    store.subscribeUpdates(() => (updates += 1));
    expect(act(store, { kind: 'pause' }, T0)).toEqual({ timer: undefined, isChanged: false });
    act(store, { kind: 'start', durationMs: 1000 }, T0);
    const written = updates;
    expect(act(store, { kind: 'resume' }, T0 + 5)).toMatchObject({ isChanged: false });
    expect(act(store, { kind: 'pause' }, T0 + 1000)).toMatchObject({ isChanged: false });
    expect(updates).toBe(written);
  });

  it('refuses a missing section, a duration out of range and an unknown action', () => {
    const store = createFixtureStore();
    const start = { kind: 'start', durationMs: 1000 };
    const [missing] = expectRejected(store, setBoardTimerCommand, {
      action: { ...start, sectionId: 'nowhere' },
      serverNowMs: T0,
    });
    expect(missing).toMatchObject({ code: 'missing-object', path: ['action', 'sectionId'] });
    for (const action of [
      { ...start, durationMs: 999 },
      { ...start, durationMs: 24 * 3_600_000 + 1 },
      { kind: 'stop' },
      { kind: 'pause', durationMs: 1000 },
    ]) {
      const [error] = expectRejected(store, setBoardTimerCommand, { action, serverNowMs: T0 });
      expect(error?.code).toBe('invalid-input');
    }
    const [time] = expectRejected(store, setBoardTimerCommand, { action: start, serverNowMs: -1 });
    expect(time?.code).toBe('invalid-input');
  });

  it('starts a timer for a section the board has', () => {
    const store = createFixtureStore();
    const sectionId = [...store.read().objects.keys()][0] ?? '';
    act(store, { kind: 'start', durationMs: 1000, sectionId: sectionId }, T0);
    expect(store.boardTimer.current?.sectionId).toBe(sectionId);
  });

  it('runs in a batch, the last action winning', () => {
    const store = createFixtureStore();
    const batch = batchCommand(setBoardTimerCommand, 'actions');
    applyCommand(
      store,
      batch,
      {
        actions: [
          { action: { kind: 'start', durationMs: 60_000 }, serverNowMs: T0, actor: ADA_ID },
          { action: { kind: 'pause' }, serverNowMs: T0 + 1000, actor: ADA_ID },
        ],
      },
      SYSTEM_ORIGIN,
    );
    expect(store.boardTimer.current).toMatchObject({ status: 'paused', remainingMs: 59_000 });
  });

  it('never enters an undo history, whatever the origin', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    applyCommand(store, setBoardTimerCommand, {
      action: { kind: 'start', durationMs: 1000 },
      serverNowMs: T0,
    });
    act(store, { kind: 'pause' }, T0 + 1);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe(false);
    expect(store.boardTimer.current?.status).toBe('paused');
    history.destroy();
  });

  it('tells timer listeners of local and remote changes, and adds no change set', () => {
    const store = createFixtureStore();
    let timerChanges = 0;
    let changeSets = 0;
    store.boardTimer.subscribe(() => (timerChanges += 1));
    const stop = store.subscribe(() => (changeSets += 1));
    act(store, { kind: 'start', durationMs: 1000 }, T0);
    const peer = new YjsDocumentStore();
    peer.applyUpdate(store.encodeState(), RELAY);
    expect(peer.boardTimer.current).toEqual(store.boardTimer.current);
    let peerChanges = 0;
    peer.boardTimer.subscribe(() => (peerChanges += 1));
    const before = store.encodeStateVector();
    act(store, { kind: 'pause' }, T0 + 1);
    peer.applyUpdate(store.encodeState(before), RELAY);
    expect(peer.boardTimer.current?.status).toBe('paused');
    expect([timerChanges, peerChanges, changeSets]).toEqual([2, 1, 0]);
    stop();
  });

  it('reads a stored value that does not validate as no timer', () => {
    const doc = new Y.Doc();
    doc.getMap(FACILITATION_MAP_NAME).set(BOARD_TIMER_KEY, { status: 'running', durationMs: -5 });
    const store = new YjsDocumentStore();
    store.applyUpdate(Y.encodeStateAsUpdate(doc), RELAY);
    expect(store.boardTimer.current).toBeUndefined();
    expect(internalsOf(store).doc.getMap(FACILITATION_MAP_NAME).has(BOARD_TIMER_KEY)).toBe(true);
  });
});
