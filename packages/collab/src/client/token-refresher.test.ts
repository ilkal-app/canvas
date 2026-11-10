import { describe, expect, it, vi } from 'vitest';

import { ManualTime } from '../presence/__fixtures__/manual-time.js';

import type { RefreshOutcome } from './connection-tokens.js';
import {
  REFRESH_SEND_DEADLINE_MS,
  refreshDelayMs,
  TokenRefresher,
  type TokenRefresherHost,
} from './token-refresher.js';

// The client's refresh schedule (design section 4), on manual time: nothing before the
// relay's announcement, the 75-80% point with jitter, the minimum delay, no refresh for a token
// about to expire, the deadline, one refresh unanswered at most, retries, disposal.

const MINUTES_10 = 600_000;

/** A refresher on manual time with a provider the test answers. */
interface Rig {
  readonly time: ManualTime;
  readonly refresher: TokenRefresher;
  readonly host: TokenRefresherHost;
  readonly fetches: ((outcome: RefreshOutcome) => void)[];
  readonly sent: string[];
  readonly refreshed: string[];
  readonly reported: unknown[];
}

/**
 * Builds a refresher.
 *
 * @param random - The jitter's random number.
 * @returns The rig.
 */
function rig(random = 0): Rig {
  const time = new ManualTime();
  const fetches: ((outcome: RefreshOutcome) => void)[] = [];
  const sent: string[] = [];
  const refreshed: string[] = [];
  const reported: unknown[] = [];
  const host: TokenRefresherHost = {
    scheduler: time,
    clock: time,
    random: () => random,
    fetch: (deliver) => fetches.push(deliver),
    send: (token) => sent.push(token),
    onRefreshed: (token) => refreshed.push(token),
    report: (error) => reported.push(error),
  };
  return { time, refresher: new TokenRefresher(host), host, fetches, sent, refreshed, reported };
}

describe('refreshDelayMs', () => {
  it('refreshes a fresh 10-minute token at 75 to 80% of its lifetime', () => {
    expect(refreshDelayMs(MINUTES_10, 0)).toBe(480_000);
    expect(refreshDelayMs(MINUTES_10, 0.999_999)).toBeCloseTo(450_000, -1);
  });

  it('keeps at least a minute of lead, and waits at least 5 s', () => {
    expect(refreshDelayMs(120_000, 0)).toBe(60_000);
    expect(refreshDelayMs(20_000, 0.5)).toBe(5_000);
  });
});

describe('TokenRefresher', () => {
  it('does nothing until the relay announces the token', () => {
    const { time, fetches } = rig();
    time.advanceBy(10 * MINUTES_10);
    expect(fetches).toHaveLength(0);
    expect(time.pendingTaskCount).toBe(0);
  });

  it('asks at the scheduled point, sends the token, and reschedules on the acknowledgement', () => {
    const { time, refresher, fetches, sent, refreshed } = rig(0.5);
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(465_000 - 1);
    expect(fetches).toHaveLength(0);
    time.advanceBy(1);
    expect(fetches).toHaveLength(1);
    fetches[0]?.({ kind: 'token', token: 'second' });
    expect(sent).toEqual(['second']);
    refresher.receive('token-refreshed', MINUTES_10);
    expect(refreshed).toEqual(['second']);
    time.advanceBy(465_000);
    expect(fetches).toHaveLength(2);
  });

  it('never sends twice without an acknowledgement, and ignores a stray one', () => {
    const { time, refresher, fetches, sent, refreshed } = rig();
    refresher.receive('token-refreshed', MINUTES_10);
    expect(refreshed).toEqual([]);
    expect(time.pendingTaskCount).toBe(0);
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    fetches[0]?.({ kind: 'token', token: 'second' });
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(10 * MINUTES_10);
    expect(fetches).toHaveLength(1);
    expect(sent).toEqual(['second']);
  });

  it('does not refresh a token announced with under 15 s left', () => {
    const { time, refresher, fetches } = rig();
    refresher.receive('token-expiry', 14_999);
    time.advanceBy(60_000);
    expect(fetches).toHaveLength(0);
  });

  it('sends nothing once the deadline has passed, as after a sleeping tab', () => {
    const { time, refresher, fetches, sent } = rig();
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    time.advanceBy(MINUTES_10 - 480_000 - REFRESH_SEND_DEADLINE_MS + 1);
    fetches[0]?.({ kind: 'token', token: 'late' });
    expect(sent).toEqual([]);
  });

  it('asks again once after a stale token, then gives up', () => {
    const { time, refresher, fetches, sent } = rig();
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    fetches[0]?.({ kind: 'stale' });
    time.advanceBy(60_000);
    expect(fetches).toHaveLength(2);
    fetches[1]?.({ kind: 'stale' });
    time.advanceBy(MINUTES_10);
    expect(fetches).toHaveLength(2);
    expect(sent).toEqual([]);
  });

  it('reports a provider failure and asks again after 15 s', () => {
    const { time, refresher, fetches, reported } = rig();
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    const error = new Error('unavailable');
    fetches[0]?.({ kind: 'failed', error });
    expect(reported).toEqual([error]);
    time.advanceBy(15_000);
    expect(fetches).toHaveLength(2);
  });

  it('reports an invalid token and stops refreshing', () => {
    const { time, refresher, fetches, reported, sent } = rig();
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    const error = new RangeError('another board');
    fetches[0]?.({ kind: 'invalid', error });
    time.advanceBy(MINUTES_10);
    expect(reported).toEqual([error]);
    expect(fetches).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it('cancels its timer and ignores a late token once disposed', () => {
    const { time, refresher, fetches, sent, host } = rig();
    const send = vi.spyOn(host, 'send');
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000);
    refresher.dispose();
    fetches[0]?.({ kind: 'token', token: 'late' });
    refresher.receive('token-expiry', MINUTES_10);
    expect(time.pendingTaskCount).toBe(0);
    expect(sent).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("waits at least 30 s after an acknowledgement, the relay's own bound", () => {
    const { time, refresher, fetches } = rig();
    refresher.receive('token-expiry', 40_000);
    time.advanceBy(5_000);
    expect(fetches).toHaveLength(1);
    fetches[0]?.({ kind: 'token', token: 'second' });
    refresher.receive('token-refreshed', 40_000);
    time.advanceBy(30_000 - 1);
    expect(fetches).toHaveLength(1);
    time.advanceBy(1);
    expect(fetches).toHaveLength(2);
  });

  it('reschedules from a second announcement, dropping the first schedule', () => {
    const { time, refresher, fetches } = rig();
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(100_000);
    refresher.receive('token-expiry', MINUTES_10);
    time.advanceBy(480_000 - 1);
    expect(fetches).toHaveLength(0);
    time.advanceBy(1);
    expect(fetches).toHaveLength(1);
  });

  it('asks nothing when a sleeping tab wakes past the deadline, its timer late', () => {
    const time = new ManualTime();
    let sleptMs = 0;
    const fetches: unknown[] = [];
    const refresher = new TokenRefresher({
      scheduler: time,
      // Wall time jumps across a sleep while the timers stand still.
      clock: { now: () => time.now() + sleptMs },
      random: () => 0,
      fetch: (deliver) => fetches.push(deliver),
      send: () => undefined,
      onRefreshed: () => undefined,
      report: () => undefined,
    });
    refresher.receive('token-expiry', MINUTES_10);
    sleptMs = 120_000 - REFRESH_SEND_DEADLINE_MS + 1;
    time.advanceBy(480_000);
    expect(fetches).toHaveLength(0);
  });
});
