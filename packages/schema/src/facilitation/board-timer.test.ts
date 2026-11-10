import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '../ids/principal-id.js';

import { applyTimerAction } from './board-timer-action.js';
import {
  boardTimerSchema,
  DEFAULT_TIMER_DURATION_MS,
  isTimerExpired,
  MAX_TIMER_DURATION_MS,
  MIN_TIMER_DURATION_MS,
  timerEndsAt,
  timerRemainingMs,
  type BoardTimer,
} from './board-timer.js';

const ADA = 'user:ada' as PrincipalId;
const BOB = 'user:bob' as PrincipalId;
const T0 = 1_760_000_000_000;

const running: BoardTimer = {
  status: 'running',
  durationMs: 60_000,
  remainingMs: 60_000,
  startedAt: T0,
  sectionId: null,
  updatedBy: ADA,
};

describe('boardTimerSchema', () => {
  it('accepts an idle, a running and a paused timer', () => {
    const idle = {
      status: 'idle',
      durationMs: DEFAULT_TIMER_DURATION_MS,
      sectionId: null,
      updatedBy: ADA,
    };
    expect(boardTimerSchema.parse(idle)).toEqual(idle);
    expect(boardTimerSchema.parse(running)).toEqual(running);
    const paused = { ...idle, status: 'paused', remainingMs: 1000, sectionId: 'section-1' };
    expect(boardTimerSchema.parse(paused)).toEqual(paused);
  });

  it('refuses durations out of range, more left than the duration and stray fields', () => {
    for (const durationMs of [MIN_TIMER_DURATION_MS - 1, MAX_TIMER_DURATION_MS + 1, 1500.5])
      expect(boardTimerSchema.safeParse({ ...running, durationMs, remainingMs: 0 }).success).toBe(
        false,
      );
    expect(boardTimerSchema.safeParse({ ...running, remainingMs: 60_001 }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, remainingMs: -1 }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, startedAt: -1 }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, votes: 3 }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, status: 'done' }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, updatedBy: 'undo' }).success).toBe(false);
    expect(boardTimerSchema.safeParse({ ...running, startedAt: undefined }).success).toBe(false);
  });
});

describe('timerRemainingMs', () => {
  it('counts a running timer down by the relay clock and stops at zero', () => {
    expect(timerRemainingMs(running, T0)).toBe(60_000);
    expect(timerRemainingMs(running, T0 + 1_500)).toBe(58_500);
    expect(timerRemainingMs(running, T0 + 59_999.4)).toBe(1);
    expect(timerRemainingMs(running, T0 + 60_000)).toBe(0);
    expect(timerRemainingMs(running, T0 + 3_600_000)).toBe(0);
    expect(timerEndsAt(running)).toBe(T0 + 60_000);
  });

  it('never runs past the written value for a reader whose estimate is behind the writer', () => {
    expect(timerRemainingMs(running, T0 - 400)).toBe(60_000);
  });

  it('holds still while paused or idle', () => {
    const paused = act(running, { kind: 'pause' }, T0 + 10_000, BOB);
    expect(paused).toMatchObject({ status: 'paused', remainingMs: 50_000, updatedBy: BOB });
    expect(timerRemainingMs(paused, T0 + 999_999)).toBe(50_000);
    expect(timerEndsAt(paused)).toBeUndefined();
    const idle = act(running, { kind: 'reset' }, T0, BOB);
    expect(timerRemainingMs(idle, T0 + 999_999)).toBe(60_000);
  });

  it('shows readers whose relay-clock estimates differ by e times that differ by at most e', () => {
    for (const error of [0, 1, 99, 250])
      for (const at of [T0, T0 + 1, T0 + 30_000, T0 + 59_900])
        expect(
          Math.abs(timerRemainingMs(running, at) - timerRemainingMs(running, at + error)),
        ).toBeLessThanOrEqual(error);
  });

  it('reads a timer as expired only when it runs with nothing left', () => {
    expect(isTimerExpired(running, T0 + 59_999)).toBe(false);
    expect(isTimerExpired(running, T0 + 60_000)).toBe(true);
    const paused = act(running, { kind: 'pause' }, T0 + 1, ADA);
    expect(isTimerExpired(paused, T0 + 999_999)).toBe(false);
  });
});

describe('applyTimerAction', () => {
  it('starts from the whole duration at the moment, for a section or the board', () => {
    expect(
      applyTimerAction(undefined, { kind: 'start', durationMs: 60_000 }, T0 + 0.7, ADA),
    ).toEqual(running);
    expect(
      applyTimerAction(
        running,
        { kind: 'start', durationMs: 1000, sectionId: 'section-1' as BoardTimer['sectionId'] },
        T0,
        BOB,
      ),
    ).toMatchObject({ remainingMs: 1000, sectionId: 'section-1', updatedBy: BOB });
  });

  it('resumes a paused timer from what it held, from the moment of the resume', () => {
    const paused = applyTimerAction(running, { kind: 'pause' }, T0 + 10_000, ADA);
    const resumed = act(paused, { kind: 'resume' }, T0 + 70_000, BOB);
    expect(resumed).toMatchObject({
      status: 'running',
      remainingMs: 50_000,
      startedAt: T0 + 70_000,
    });
    expect(timerRemainingMs(resumed, T0 + 80_000)).toBe(40_000);
    expect(isValidTimer(resumed)).toBe(true);
  });

  it('leaves the timer as it is when an action does not apply', () => {
    expect(applyTimerAction(running, { kind: 'resume' }, T0, ADA)).toBe(running);
    expect(applyTimerAction(running, { kind: 'pause' }, T0 + 60_000, ADA)).toBe(running);
    const paused = act(running, { kind: 'pause' }, T0 + 1, ADA);
    expect(applyTimerAction(paused, { kind: 'pause' }, T0 + 2, BOB)).toBe(paused);
    const empty = { ...paused, remainingMs: 0 } as BoardTimer;
    expect(applyTimerAction(empty, { kind: 'resume' }, T0, BOB)).toBe(empty);
    for (const kind of ['pause', 'resume', 'reset'] as const)
      expect(applyTimerAction(undefined, { kind }, T0, ADA)).toBeUndefined();
    expect(applyTimerAction(undefined, { kind: 'set-duration', durationMs: 1000 }, T0, ADA)).toBe(
      undefined,
    );
  });

  it('resets to idle, sets a new duration and ends', () => {
    expect(applyTimerAction(running, { kind: 'reset' }, T0 + 5, BOB)).toEqual({
      status: 'idle',
      durationMs: 60_000,
      sectionId: null,
      updatedBy: BOB,
    });
    expect(
      applyTimerAction(running, { kind: 'set-duration', durationMs: 120_000 }, T0, BOB),
    ).toMatchObject({ status: 'idle', durationMs: 120_000 });
    expect(applyTimerAction(running, { kind: 'end' }, T0, BOB)).toBeUndefined();
  });

  it('never changes its input', () => {
    const input = Object.freeze({ ...running });
    applyTimerAction(input, { kind: 'pause' }, T0 + 1, BOB);
    applyTimerAction(input, { kind: 'reset' }, T0 + 1, BOB);
    expect(input).toEqual(running);
  });
});

/**
 * Applies an action that must leave a timer.
 *
 * @param args - As for `applyTimerAction`.
 * @returns The timer after the action.
 * @throws {Error} When the action left no timer.
 */
function act(...args: Parameters<typeof applyTimerAction>): BoardTimer {
  const timer = applyTimerAction(...args);
  if (timer === undefined) throw new Error('the action left no timer');
  return timer;
}

/**
 * Whether a value is a valid stored timer.
 *
 * @param value - Anything.
 * @returns Whether it validates.
 */
function isValidTimer(value: unknown): boolean {
  return boardTimerSchema.safeParse(value).success;
}
