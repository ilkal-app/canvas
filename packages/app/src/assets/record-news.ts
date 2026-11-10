import type { AssetRecord } from '@canvas/schema';

/**
 * Whether a record will change no more: `ready` or `failed` ends its events.
 *
 * @param record - The record.
 * @returns True when no new level will appear.
 */
export function isSettledRecord(record: AssetRecord): boolean {
  return record.status === 'ready' || record.status === 'failed';
}

/**
 * Whether a record says something the one before did not (a status, progress or level), which
 * starts the follower's waits for the asset over.
 *
 * @param before - The record known before, if any.
 * @param after - The record read.
 * @returns True when it is news.
 */
export function isNews(before: AssetRecord | undefined, after: AssetRecord): boolean {
  if (before === undefined) return true;
  return (
    before.status !== after.status ||
    before.progress !== after.progress ||
    before.levels.length !== after.levels.length
  );
}
