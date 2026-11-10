import {
  isTimerExpired,
  MAX_TIMER_DURATION_MS,
  MIN_TIMER_DURATION_MS,
  timerRemainingMs,
  type BoardTimer,
} from '@canvas/schema';

// The Facilitate card's timer text: the time as the card shows it, the time a person
// types when they set the duration, and the moment a running timer runs out. Pure.

/**
 * A time left as the card shows it: whole seconds rounded up (a timer with 200 ms left shows
 * `00:01`, so `00:00` means it has run out), as `mm:ss`, or `h:mm:ss` from an hour.
 *
 * @param ms - The time, in ms; clamped at zero.
 * @returns The text.
 */
export function formatTimerClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Reads a duration a person typed: minutes (`5`, `2.5`), `m:ss` (`4:30`) or `h:mm:ss`
 * (`1:00:00`), each part a whole number but plain minutes; spaces ignored.
 *
 * @param text - What they typed.
 * @returns The duration in ms, or `undefined` when it is not one or is outside 1 s to 24 h.
 */
export function parseTimerDuration(text: string): number | undefined {
  const trimmed = text.replaceAll(' ', '');
  let ms: number | undefined;
  if (/^\d+(\.\d+)?$/u.test(trimmed)) ms = Math.round(Number(trimmed) * 60_000);
  else if (/^\d+(:\d{1,2}){1,2}$/u.test(trimmed)) {
    const parts = trimmed.split(':').map(Number);
    const isInRange = parts.slice(1).every((part) => part < 60);
    ms = isInRange ? parts.reduce((sum, part) => sum * 60 + part, 0) * 1000 : undefined;
  }
  if (ms === undefined || ms < MIN_TIMER_DURATION_MS || ms > MAX_TIMER_DURATION_MS)
    return undefined;
  return ms;
}

/**
 * Whether a running timer ran out between two moments the card looked: running with time left at
 * the first and none at the second. A timer that had already run out, or that someone paused,
 * reset or ended meanwhile, did not just run out.
 *
 * @param before - The timer at the earlier look, if any.
 * @param beforeAt - The earlier moment, by the relay's clock.
 * @param after - The timer now, if any.
 * @param afterAt - Now, by the relay's clock.
 * @returns Whether it ran out in between.
 */
export function hasJustRunOut(
  before: BoardTimer | undefined,
  beforeAt: number,
  after: BoardTimer | undefined,
  afterAt: number,
): boolean {
  if (before === undefined || after === undefined || before.status !== 'running') return false;
  const isSameRun = after.status === 'running' && after.startedAt === before.startedAt;
  return isSameRun && timerRemainingMs(before, beforeAt) > 0 && isTimerExpired(after, afterAt);
}
