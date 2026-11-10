// Unread comment threads: by the person's own read mark from the boards service.
import { describe, expect, it } from 'vitest';

import type { Message, Thread } from './comment-api.js';
import {
  isUnread,
  nextUnreadOf,
  NO_UNREAD,
  unreadCommentsOf,
  unreadMessagesOf,
} from './comment-unread.js';

const ME = 'me';

/**
 * A message.
 *
 * @param id - Its id.
 * @param at - When it was written, minutes past the hour.
 * @param fields - What differs: its author, operator and mentions.
 * @returns The message.
 */
function message(id: string, at: number, fields: Partial<Message> = {}): Message {
  return {
    id,
    authorId: 'other',
    authorName: 'Other',
    text: id,
    mentions: [],
    createdAt: new Date(Date.UTC(2026, 9, 21, 10, at)).toISOString(),
    ...fields,
  };
}

/**
 * A thread.
 *
 * @param id - Its id.
 * @param messages - Its messages.
 * @param lastReadAt - The person's read mark, minutes past the hour; null before they read it;
 *   undefined from an older service.
 * @param isResolved - Whether it is resolved.
 * @returns The thread.
 */
function thread(
  id: string,
  messages: readonly Message[],
  lastReadAt: number | null | undefined,
  isResolved = false,
): Thread {
  return {
    id,
    pinId: `pin-${id}`,
    isResolved,
    messages,
    ...(lastReadAt === undefined
      ? {}
      : {
          lastReadAt:
            lastReadAt === null
              ? null
              : new Date(Date.UTC(2026, 9, 21, 10, lastReadAt)).toISOString(),
        }),
  };
}

describe('unreadMessagesOf', () => {
  it('is someone else’s messages after the person’s mark, all of them before they read', () => {
    const messages = [message('a', 1), message('b', 5), message('c', 9)];
    expect(unreadMessagesOf(thread('t', messages, 5), ME).map(({ id }) => id)).toEqual(['c']);
    expect(unreadMessagesOf(thread('t', messages, null), ME)).toHaveLength(3);
  });

  it('never counts the person’s own messages or their agent’s, nor any from an older service', () => {
    const messages = [
      message('mine', 9, { authorId: ME }),
      message('agent', 9, { authorId: null, authorKind: 'agent', operatorId: ME }),
    ];
    expect(unreadMessagesOf(thread('t', messages, null), ME)).toEqual([]);
    expect(unreadMessagesOf(thread('t', [message('a', 9)], undefined), ME)).toEqual([]);
  });
});

describe('isUnread', () => {
  it('is an open thread with an unread message', () => {
    expect(isUnread(thread('t', [message('a', 9)], 5), ME)).toBe(true);
    expect(isUnread(thread('t', [message('a', 9)], 5, true), ME)).toBe(false);
    expect(isUnread(thread('t', [message('a', 1)], 5), ME)).toBe(false);
  });
});

describe('unreadCommentsOf', () => {
  it('counts unread open threads, and those whose unread messages name the person', () => {
    const threads = [
      thread('mention', [message('a', 9, { mentions: [ME] })], 5),
      thread('plain', [message('b', 9)], 5),
      thread('read-mention', [message('c', 1, { mentions: [ME] }), message('d', 9)], 5),
      thread('resolved', [message('e', 9, { mentions: [ME] })], 5, true),
      thread('read', [message('f', 1)], 5),
    ];
    expect(unreadCommentsOf(threads, ME)).toEqual({ threads: 3, mentions: 1 });
    expect(unreadCommentsOf([], ME)).toEqual(NO_UNREAD);
  });
});

describe('nextUnreadOf', () => {
  it('is the first unread thread mentioning the person, else the first unread one', () => {
    const plain = thread('plain', [message('a', 9)], 5);
    const mention = thread('mention', [message('b', 9, { mentions: [ME] })], 5);
    const read = thread('read', [message('c', 1)], 5);
    expect(nextUnreadOf([read, plain, mention], ME)?.id).toBe('mention');
    expect(nextUnreadOf([read, plain], ME)?.id).toBe('plain');
    expect(nextUnreadOf([read], ME)).toBeUndefined();
  });
});
