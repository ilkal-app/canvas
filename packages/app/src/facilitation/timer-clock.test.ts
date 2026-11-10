import { describe, expect, it } from 'vitest';

import type { BoardTimer, PrincipalId } from '@canvas/schema';

import { formatTimerClock, hasJustRunOut, parseTimerDuration } from './timer-clock.js';

const T0 = 1_770_000_000_000;
const RUNNING: BoardTimer = {
  status: 'running',
  durationMs: 60_000,
  remainingMs: 60_000,
  startedAt: T0,
  sectionId: null,
  updatedBy: 'user:ada' as PrincipalId,
};

describe('formatTimerClock', () => {
  it('shows whole seconds rounded up, mm:ss below an hour and h:mm:ss from one', () => {
    expect(formatTimerClock(272_000)).toBe('04:32');
    expect(formatTimerClock(600_000)).toBe('10:00');
    expect(formatTimerClock(200)).toBe('00:01');
    expect(formatTimerClock(0)).toBe('00:00');
    expect(formatTimerClock(-5)).toBe('00:00');
    expect(formatTimerClock(3_600_000)).toBe('1:00:00');
    expect(formatTimerClock(24 * 3_600_000)).toBe('24:00:00');
  });
});

describe('parseTimerDuration', () => {
  it('reads minutes, m:ss and h:mm:ss', () => {
    expect(parseTimerDuration('5')).toBe(300_000);
    expect(parseTimerDuration(' 2.5 ')).toBe(150_000);
    expect(parseTimerDuration('4:30')).toBe(270_000);
    expect(parseTimerDuration('0:05')).toBe(5000);
    expect(parseTimerDuration('1:00:00')).toBe(3_600_000);
  });

  it('refuses anything else, and durations outside 1 s to 24 h', () => {
    for (const text of ['', 'five', '4:75', '1:2:3:4', '-1', '0', '0:00', '24:00:01', '1e3', ':30'])
      expect(parseTimerDuration(text)).toBeUndefined();
  });
});

describe('hasJustRunOut', () => {
  it('is true only when the same run went from time left to none', () => {
    expect(hasJustRunOut(RUNNING, T0 + 59_000, RUNNING, T0 + 60_000)).toBe(true);
    expect(hasJustRunOut(RUNNING, T0 + 60_000, RUNNING, T0 + 61_000)).toBe(false);
    expect(hasJustRunOut(RUNNING, T0, RUNNING, T0 + 30_000)).toBe(false);
    const paused: BoardTimer = { ...RUNNING, status: 'paused', remainingMs: 1000 };
    expect(hasJustRunOut(RUNNING, T0, paused, T0 + 60_000)).toBe(false);
    const restarted = { ...RUNNING, startedAt: T0 + 1 };
    expect(hasJustRunOut(RUNNING, T0, restarted, T0 + 70_000)).toBe(false);
    expect(hasJustRunOut(undefined, T0, RUNNING, T0 + 60_000)).toBe(false);
    expect(hasJustRunOut(RUNNING, T0, undefined, T0 + 60_000)).toBe(false);
    expect(hasJustRunOut(paused, T0, paused, T0 + 60_000)).toBe(false);
  });
});
