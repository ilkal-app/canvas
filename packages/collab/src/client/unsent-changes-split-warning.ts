/**
 * Reported once per client, to `onError`, when something goes split by struct ranges
 * (`splitUpdate`), so a chunk boundary can fall inside a transaction and peers may see part of
 * one first; an editor peer's reference repair can then rewrite a reference whose target is in
 * the next chunk, for good. That happens only for a single transaction above
 * `SINGLE_TRANSACTION_BYTES` (7 MiB, under the relay's 8 MiB limit), and for a reconnect whose
 * unsent changes are larger than one chunk and can be replayed transaction by transaction neither
 * from memory nor from the cache's log: a cache an older build compacted while it held unsent
 * work, an unreadable log, a cache without `readUpdates`, or edits whose bytes were dropped on a
 * read-only connection and whose log records were compacted meanwhile, sent after a promotion to
 * editor. A warning: syncing goes on.
 */
export class UnsentChangesSplitWarning extends Error {
  /** Creates the warning. */
  constructor() {
    super(
      'Changes were sent split by struct ranges, so peers may see part of a transaction: a ' +
        'transaction above 7 MiB, or unsent changes that could not be replayed transaction by ' +
        'transaction (a cache compacted by an older build, an unreadable log, or a cache ' +
        'without readUpdates, or edits dropped from the replay buffer while read-only).',
    );
    this.name = 'UnsentChangesSplitWarning';
  }
}
