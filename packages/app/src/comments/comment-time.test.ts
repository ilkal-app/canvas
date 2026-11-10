import { describe, expect, it } from 'vitest';

import { shortTime } from './comment-time.js';

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0); // Saturday 10 October 2026, 12:00 UTC.

/**
 * An ISO time some milliseconds before {@link NOW}.
 *
 * @param milliseconds - How long before.
 * @returns The time.
 */
function ago(milliseconds: number): string {
  return new Date(NOW - milliseconds).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('shortTime', () => {
  it('reads "now" under a minute, and for a time ahead of the clock', () => {
    expect(shortTime(ago(59_000), NOW)).toBe('now');
    expect(shortTime(ago(-5 * MINUTE), NOW)).toBe('now');
  });

  it('reads minutes, then hours', () => {
    expect(shortTime(ago(2 * MINUTE), NOW)).toBe('2m');
    expect(shortTime(ago(59 * MINUTE), NOW)).toBe('59m');
    expect(shortTime(ago(HOUR), NOW)).toBe('1h');
    expect(shortTime(ago(23 * HOUR), NOW)).toBe('23h');
  });

  it('reads a weekday within the week, then a date', () => {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    expect(shortTime(ago(2 * DAY), NOW)).toBe(weekday.format(NOW - 2 * DAY));
    const date = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
    expect(shortTime(ago(8 * DAY), NOW)).toBe(date.format(NOW - 8 * DAY));
  });

  it('adds the year to a date from another year', () => {
    const then = Date.UTC(2025, 2, 3, 12);
    const date = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    expect(shortTime(new Date(then).toISOString(), NOW)).toBe(date.format(then));
  });

  it('reads an unparseable time as nothing', () => {
    expect(shortTime('not a time', NOW)).toBe('');
  });
});
