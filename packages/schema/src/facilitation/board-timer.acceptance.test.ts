import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '../ids/principal-id.js';

import { applyTimerAction } from './board-timer-action.js';
import { isTimerExpired, timerEndsAt, timerRemainingMs } from './board-timer.js';

const RELAY_NOW = 1_770_000_000_000;
const ADA = 'user:ada' as PrincipalId;
const BOB = 'user:bob' as PrincipalId;

describe('shared timer acceptance: relay time', () => {
  it('clamps a reader behind the writer and expires at exactly zero', () => {
    const timer = applyTimerAction(
      undefined,
      { kind: 'start', durationMs: 60_000 },
      RELAY_NOW,
      ADA,
    );
    expect(timer?.status).toBe('running');
    if (timer === undefined) throw new Error('start must create a timer');
    const unchanged = structuredClone(timer);
    expect(timerEndsAt(timer)).toBe(RELAY_NOW + 60_000);
    expect(timerRemainingMs(timer, RELAY_NOW - 180_000)).toBe(60_000);
    expect(isTimerExpired(timer, RELAY_NOW + 59_999)).toBe(false);
    expect(timerRemainingMs(timer, RELAY_NOW + 60_000)).toBe(0);
    expect(isTimerExpired(timer, RELAY_NOW + 60_000)).toBe(true);
    expect(timerRemainingMs(timer, RELAY_NOW + 300_000)).toBe(0);
    expect(timer).toEqual(unchanged);
  });

  it('holds the relay-clock remainder across a long pause and resumes from that remainder', () => {
    const started = applyTimerAction(
      undefined,
      { kind: 'start', durationMs: 60_000 },
      RELAY_NOW,
      ADA,
    );
    const paused = applyTimerAction(started, { kind: 'pause' }, RELAY_NOW + 12_345, BOB);
    expect(paused).toMatchObject({ status: 'paused', remainingMs: 47_655, updatedBy: BOB });
    if (paused === undefined) throw new Error('pause must retain a timer');
    expect(timerRemainingMs(paused, RELAY_NOW + 1_000_000)).toBe(47_655);
    expect(isTimerExpired(paused, RELAY_NOW + 1_000_000)).toBe(false);
    const resumed = applyTimerAction(paused, { kind: 'resume' }, RELAY_NOW + 1_000_000, ADA);
    expect(resumed).toMatchObject({
      status: 'running',
      remainingMs: 47_655,
      startedAt: RELAY_NOW + 1_000_000,
    });
    if (resumed === undefined) throw new Error('resume must retain a timer');
    expect(timerRemainingMs(resumed, RELAY_NOW + 1_047_654)).toBe(1);
    expect(timerRemainingMs(resumed, RELAY_NOW + 1_047_655)).toBe(0);
    expect(paused).toMatchObject({ status: 'paused', remainingMs: 47_655 });
  });
});
