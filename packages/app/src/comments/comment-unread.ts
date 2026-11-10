import type { Message, Thread } from './comment-api.js';

// Unread comment threads (the coordinator's ruling of 2026-10-21): each person's
// read mark of each thread lives in the boards service (`lastReadAt`, their own only). Pure.

/** How many threads are unread for a person, and how many of them mention them. */
export interface UnreadComments {
  /** The open threads with a message by someone else since the person last read them. */
  readonly threads: number;
  /** Of those, the ones whose unread messages name the person. */
  readonly mentions: number;
}

/** Nothing unread. */
export const NO_UNREAD: UnreadComments = { threads: 0, mentions: 0 };

/**
 * Whether a message is the person's own: written by them, or by their agent for them.
 *
 * @param message - The message.
 * @param userId - The person.
 * @returns Whether it is theirs.
 */
function isOwn(message: Message, userId: string): boolean {
  return message.authorId === userId || message.operatorId === userId;
}

/**
 * A thread's messages the person has not read: by someone else, after their read mark. A thread
 * the service sent no mark for (one older than read marks) has none.
 *
 * @param thread - The thread.
 * @param userId - The person.
 * @returns The unread messages, in order.
 */
export function unreadMessagesOf(thread: Thread, userId: string): Message[] {
  if (thread.lastReadAt === undefined) return [];
  const mark =
    thread.lastReadAt === null ? Number.NEGATIVE_INFINITY : Date.parse(thread.lastReadAt);
  return thread.messages.filter(
    (message) => !isOwn(message, userId) && Date.parse(message.createdAt) > mark,
  );
}

/**
 * Whether a thread is unread for the person: open, with a message by someone else since they
 * last read it.
 *
 * @param thread - The thread.
 * @param userId - The person.
 * @returns Whether it is unread.
 */
export function isUnread(thread: Thread, userId: string): boolean {
  return !thread.isResolved && unreadMessagesOf(thread, userId).length > 0;
}

/**
 * How many open threads are unread for the person, and how many of them mention them.
 *
 * @param threads - The board's threads.
 * @param userId - The person.
 * @returns The counts.
 */
export function unreadCommentsOf(threads: readonly Thread[], userId: string): UnreadComments {
  let unread = 0;
  let mentions = 0;
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const messages = unreadMessagesOf(thread, userId);
    if (messages.length === 0) continue;
    unread += 1;
    if (messages.some((message) => message.mentions.includes(userId))) mentions += 1;
  }
  return { threads: unread, mentions };
}

/**
 * The thread the board menu's "Unread comments" goes to: the first unread one that mentions the
 * person, else the first unread one, in the service's order.
 *
 * @param threads - The board's threads.
 * @param userId - The person.
 * @returns The thread, or undefined with nothing unread.
 */
export function nextUnreadOf(threads: readonly Thread[], userId: string): Thread | undefined {
  const unread = threads.filter((thread) => isUnread(thread, userId));
  return (
    unread.find((thread) =>
      unreadMessagesOf(thread, userId).some((message) => message.mentions.includes(userId)),
    ) ?? unread[0]
  );
}
