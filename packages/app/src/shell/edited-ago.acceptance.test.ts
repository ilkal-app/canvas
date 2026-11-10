// The floating board bar's relative edit time, with fixed locales and clock values.
import { describe, expect, it } from 'vitest';

import { editedAgo } from './edited-ago.js';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const format = editedAgo as (at: number, now: number, locale: string) => string;

describe('editedAgo', () => {
  it.each(['en-GB', 'en-US'])(
    'uses just now before one minute and for future times in %s',
    (locale) => {
      expect(format(NOW, NOW, locale)).toBe('just now');
      expect(format(NOW - 59_999, NOW, locale)).toBe('just now');
      expect(format(NOW + 1, NOW, locale)).toBe('just now');
    },
  );

  it.each(['en-GB', 'en-US'])(
    'switches from minutes to hours at their boundaries in %s',
    (locale) => {
      expect(format(NOW - 60_000, NOW, locale)).toBe('1 minute ago');
      expect(format(NOW - 5 * 60_000, NOW, locale)).toBe('5 minutes ago');
      expect(format(NOW - 59 * 60_000, NOW, locale)).toBe('59 minutes ago');
      expect(format(NOW - 60 * 60_000, NOW, locale)).toBe('1 hour ago');
      expect(format(NOW - 2 * 60 * 60_000, NOW, locale)).toBe('2 hours ago');
    },
  );

  it.each(['en-GB', 'en-US'])('uses yesterday and then plural days in %s', (locale) => {
    expect(format(NOW - 23 * 60 * 60_000, NOW, locale)).toBe('23 hours ago');
    expect(format(NOW - 24 * 60 * 60_000, NOW, locale)).toBe('yesterday');
    expect(format(NOW - 3 * 24 * 60 * 60_000, NOW, locale)).toBe('3 days ago');
  });
});
