const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago an edit was, for the floating board bar's subtitle: "just now" under a
 * minute (and for a time not yet reached, a clock a little ahead), then whole minutes, hours and
 * days in the locale's words (`Intl.RelativeTimeFormat`, numeric `auto`: "1 minute ago",
 * "2 hours ago", "yesterday", "3 days ago"). Pure.
 *
 * @param at - When the edit was, in ms since the epoch.
 * @param now - The time now, in ms since the epoch.
 * @param locale - The locale to word it in; the runtime's default if absent.
 * @returns The phrase.
 */
export function editedAgo(at: number, now: number, locale?: string): string {
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return 'just now';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsed < HOUR_MS) return format.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return format.format(-Math.floor(elapsed / HOUR_MS), 'hour');
  return format.format(-Math.floor(elapsed / DAY_MS), 'day');
}
