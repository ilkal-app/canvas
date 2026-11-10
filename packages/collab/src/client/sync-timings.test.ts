import { afterEach, expect, it, vi } from 'vitest';

import { CollabStatusHolder } from './collab-status-holder.js';
import { SyncTimer } from './sync-timings.js';

let nowMs = 0;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Freezes `performance.now()` at a value the test moves.
 *
 * @returns A timer over the frozen clock.
 */
function frozenTimer(): SyncTimer {
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  return new SyncTimer();
}

it('splits the first sync into consecutive phases', () => {
  const timer = frozenTimer();
  timer.markSocketRequested();
  nowMs = 4;
  timer.markAuthenticated();
  nowMs = 9;
  timer.markStepTwo();
  expect(timer.timings).toBeUndefined();
  nowMs = 15;
  timer.markSynced();
  expect(timer.timings).toEqual({ authMs: 4, receiveMs: 5, applyMs: 6 });
});

it('measures only the attempt that synced, from its own socket request', () => {
  const timer = frozenTimer();
  timer.markSocketRequested();
  nowMs = 3;
  timer.markAuthenticated();
  nowMs = 100;
  timer.markSocketRequested();
  nowMs = 102;
  timer.markAuthenticated();
  nowMs = 105;
  timer.markStepTwo();
  nowMs = 106;
  timer.markSynced();
  expect(timer.timings).toEqual({ authMs: 2, receiveMs: 3, applyMs: 1 });
});

it('ignores marks out of order and keeps the first sync after reconnections', () => {
  const timer = frozenTimer();
  timer.markAuthenticated();
  timer.markStepTwo();
  timer.markSynced();
  expect(timer.timings).toBeUndefined();
  timer.markSocketRequested();
  timer.markStepTwo();
  timer.markSynced();
  expect(timer.timings).toBeUndefined();
  nowMs = 1;
  timer.markAuthenticated();
  nowMs = 2;
  timer.markAuthenticated();
  timer.markStepTwo();
  nowMs = 7;
  timer.markStepTwo();
  timer.markSynced();
  const first = timer.timings;
  expect(first).toEqual({ authMs: 1, receiveMs: 1, applyMs: 5 });
  expect(Object.isFrozen(first)).toBe(true);
  nowMs = 50;
  timer.markSocketRequested();
  timer.markAuthenticated();
  timer.markStepTwo();
  timer.markSynced();
  expect(timer.timings).toBe(first);
});

it('marks the sync at the first connected status with nothing pending, as whenSynced reads it', () => {
  const timer = frozenTimer();
  const status = new CollabStatusHolder({
    state: 'connecting',
    lastSyncedAt: undefined,
    pendingUpdateCount: 1,
    isReadOnly: false,
    isAcknowledged: false,
    rejectionReason: undefined,
  });
  const stop = timer.markSyncedOn(status);
  timer.markSocketRequested();
  timer.markAuthenticated();
  nowMs = 2;
  timer.markStepTwo();
  nowMs = 5;
  status.transition('synced');
  expect(timer.timings).toBeUndefined();
  nowMs = 9;
  status.update({ pendingUpdateCount: 0 });
  expect(timer.timings).toEqual({ authMs: 0, receiveMs: 2, applyMs: 7 });
  stop();
});

it('stops watching the status once the timings are fixed', () => {
  const timer = frozenTimer();
  const status = new CollabStatusHolder({
    state: 'connecting',
    lastSyncedAt: undefined,
    pendingUpdateCount: 0,
    isReadOnly: false,
    isAcknowledged: false,
    rejectionReason: undefined,
  });
  const subscribe = vi.spyOn(status, 'subscribe');
  timer.markSyncedOn(status);
  const stop = subscribe.mock.results[0]?.value as () => boolean;
  timer.markSocketRequested();
  timer.markAuthenticated();
  timer.markStepTwo();
  status.transition('synced');
  expect(timer.timings).toBeDefined();
  // A second removal finds nothing: the listener already removed itself.
  expect(stop()).toBe(false);
});
