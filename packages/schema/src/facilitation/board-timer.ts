import { z } from 'zod';

import { objectIdSchema } from '../ids/object-id.js';
import { principalIdSchema } from '../ids/principal-id.js';

// The board's shared timer: one per board, in the document so late joiners see it and
// it survives reloads. Times are on the relay's clock ("server time"): a writer stamps
// `startedAt` with its estimate of the relay's clock, and every reader counts down against its
// own estimate, so two clients whose own clocks disagree still show the same time. The state is
// written whole, as one value, so concurrent pauses and resumes converge to one writer's state.

/** The shortest duration a timer may be set to, in ms: one second. */
export const MIN_TIMER_DURATION_MS = 1000;

/** The longest duration a timer may be set to, in ms: 24 hours. */
export const MAX_TIMER_DURATION_MS = 24 * 60 * 60 * 1000;

/** The duration a new timer starts with, in ms: five minutes. */
export const DEFAULT_TIMER_DURATION_MS = 5 * 60 * 1000;

const durationMsSchema = z
  .number()
  .int()
  .min(MIN_TIMER_DURATION_MS)
  .max(MAX_TIMER_DURATION_MS)
  .describe('The duration the timer was set to, in ms.');

const remainingMsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_TIMER_DURATION_MS)
  .describe('The time left, in ms, as of `startedAt` while running, else now.');

const commonFields = {
  /** The duration the timer was set to, in ms. */
  durationMs: durationMsSchema,
  /** The section the timer is for, or null for the board. */
  sectionId: objectIdSchema.nullable().describe('The section the timer is for, or null.'),
  /** Who started, paused, resumed or reset it last. */
  updatedBy: principalIdSchema.describe('Who started, paused, resumed or reset it last.'),
};

/** A timer set but not counting: its time left is its whole duration. */
const idleTimerSchema = z.strictObject({
  /** Set, not counting. */
  status: z.literal('idle'),
  ...commonFields,
});

/** A timer counting down from `remainingMs` since `startedAt` (the relay's clock, ms). */
const runningTimerSchema = z.strictObject({
  /** Counting down. */
  status: z.literal('running'),
  ...commonFields,
  /** The time left as of `startedAt`, in ms. */
  remainingMs: remainingMsSchema,
  /** When it started or resumed, by the relay's clock. */
  startedAt: z
    .number()
    .int()
    .nonnegative()
    .describe('When it started or resumed, ms since the epoch by the relay clock.'),
});

/** A paused timer, holding the time it had left. */
const pausedTimerSchema = z.strictObject({
  /** Paused. */
  status: z.literal('paused'),
  ...commonFields,
  /** The time it held when paused, in ms. */
  remainingMs: remainingMsSchema,
});

/**
 * Validates the board timer as stored: `idle` (set, not counting), `running` (counting
 * down `remainingMs` from `startedAt`, the relay's clock) or `paused` (holding `remainingMs`).
 * A running or paused timer never has more left than its duration.
 */
export const boardTimerSchema = z
  .discriminatedUnion('status', [idleTimerSchema, runningTimerSchema, pausedTimerSchema])
  .refine((timer) => timer.status === 'idle' || timer.remainingMs <= timer.durationMs, {
    message: 'a timer never has more left than its duration',
    path: ['remainingMs'],
  });

/** The board timer. */
export type BoardTimer = z.output<typeof boardTimerSchema>;

/** One of the timer's states. */
export type BoardTimerStatus = BoardTimer['status'];

/**
 * The time a timer has left at a moment, in ms: its duration when idle, what it held when
 * paused, and while running what it had at `startedAt` less the time since, clamped to
 * `[0, remainingMs]`. A moment before `startedAt` (a reader's estimate of the relay's clock a
 * little behind the writer's) counts as `startedAt`, so the time never runs backwards past the
 * value written.
 *
 * @param timer - The timer.
 * @param serverNowMs - The moment, by the relay's clock (ms since the epoch).
 * @returns The time left, in whole ms.
 */
export function timerRemainingMs(timer: BoardTimer, serverNowMs: number): number {
  switch (timer.status) {
    case 'idle':
      return timer.durationMs;
    case 'paused':
      return timer.remainingMs;
    case 'running': {
      const elapsed = Math.max(0, serverNowMs - timer.startedAt);
      return Math.max(0, Math.ceil(timer.remainingMs - elapsed));
    }
  }
}

/**
 * When a running timer reaches zero, by the relay's clock.
 *
 * @param timer - The timer.
 * @returns ms since the epoch, or `undefined` when it is not running.
 */
export function timerEndsAt(timer: BoardTimer): number | undefined {
  return timer.status === 'running' ? timer.startedAt + timer.remainingMs : undefined;
}

/**
 * Whether a timer has run out: it is running with nothing left. A paused or idle timer never
 * has.
 *
 * @param timer - The timer.
 * @param serverNowMs - The moment, by the relay's clock.
 * @returns Whether it has expired.
 */
export function isTimerExpired(timer: BoardTimer, serverNowMs: number): boolean {
  return timer.status === 'running' && timerRemainingMs(timer, serverNowMs) === 0;
}
