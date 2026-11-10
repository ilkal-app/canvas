import { matchesQuery } from '@canvas/document';

import type { Thread } from '../comments/comment-api.js';

/** A comment thread the board search found: its first matching message. */
export interface CommentHit {
  /** The thread. */
  readonly threadId: string;
  /** Its pin in the document. */
  readonly pinId: string;
  /** The row's label: the message's author, a colon and the message ("Ana: try triage at 10?"). */
  readonly text: string;
  /** When that message was written, ISO. */
  readonly createdAt: string;
  /** Whether the thread is resolved. */
  readonly isResolved: boolean;
}

/** What {@link searchComments} searches. */
export interface CommentSearchOptions {
  /** Whether resolved threads are searched too (the sheet's Resolved switch). */
  readonly shouldIncludeResolved: boolean;
  /** Whether a thread's pin is on the pages searched; every pin when absent. */
  readonly isShown?: ((pinId: string) => boolean) | undefined;
}

/**
 * The comment threads a query finds, in the threads' order: a thread matches when one of its
 * messages, or its author's name, matches (`matchesQuery`: case- and accent-blind, word prefix,
 * CJK anywhere); its result is the first such message. The text is the client's own copy of the
 * threads (`CommentData.threads`), so nothing is asked of the server. Pure.
 *
 * @param threads - The board's threads.
 * @param query - The query.
 * @param options - Whether resolved threads count, and which pins are on the pages searched.
 * @returns The results; none for a blank query.
 */
export function searchComments(
  threads: readonly Thread[],
  query: string,
  options: CommentSearchOptions,
): readonly CommentHit[] {
  if (query.trim() === '') return [];
  return threads.flatMap((thread) => {
    if (thread.isResolved && !options.shouldIncludeResolved) return [];
    if (options.isShown !== undefined && !options.isShown(thread.pinId)) return [];
    const message = thread.messages.find(
      (each) => matchesQuery(each.text, query) || matchesQuery(each.authorName, query),
    );
    if (message === undefined) return [];
    return [
      {
        threadId: thread.id,
        pinId: thread.pinId,
        text: `${message.authorName}: ${message.text}`,
        createdAt: message.createdAt,
        isResolved: thread.isResolved,
      },
    ];
  });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A comment's age as frame B shows it beside the result: "now" under a minute (or ahead of the
 * clock), then whole minutes, hours or days ("5 m", "2 h", "3 d").
 *
 * @param createdAt - When it was written, ISO.
 * @param now - The time now, ms since the epoch.
 * @returns The age, or "" for a time that does not parse.
 */
export function commentAge(createdAt: string, now: number): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return '';
  const age = now - at;
  if (age < MINUTE_MS) return 'now';
  if (age < HOUR_MS) return `${String(Math.floor(age / MINUTE_MS))} m`;
  if (age < DAY_MS) return `${String(Math.floor(age / HOUR_MS))} h`;
  return `${String(Math.floor(age / DAY_MS))} d`;
}
