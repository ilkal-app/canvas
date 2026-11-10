const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A message's time as the card shows it: "now", "2m", "1h", a weekday within the
 * week ("Mon"), then a date ("3 Mar"), with its year when it is not this year's. A time ahead of
 * the clock reads "now". Pure.
 *
 * @param iso - The message's ISO time.
 * @param now - The current time, ms since the epoch.
 * @returns The short time, or an empty string for a time that does not parse.
 */
export function shortTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const elapsed = now - then;
  if (elapsed < MINUTE_MS) return 'now';
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))}m`;
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h`;
  if (elapsed < 7 * DAY_MS)
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(then);
  const isThisYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(isThisYear ? {} : { year: 'numeric' }),
  }).format(then);
}
