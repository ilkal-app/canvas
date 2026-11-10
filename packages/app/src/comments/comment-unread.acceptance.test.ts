// CONTRACT: unread means another person's message strictly after this person's mark;
// only unread mentions count, and the menu chooses the first mentioned unread thread.
import { describe, expect, it } from 'vitest';

import type { Message, Thread } from './comment-api.js';
import { nextUnreadOf, unreadCommentsOf, unreadMessagesOf } from './comment-unread.js';

const ME = 'person';
const AT = '2026-10-21T12:00:00.000Z';
const LATER = '2026-10-21T12:00:00.001Z';

function message(id: string, createdAt = LATER, fields: Partial<Message> = {}): Message {
  return {
    id,
    createdAt,
    authorId: 'another',
    authorName: 'Another',
    text: id,
    mentions: [],
    ...fields,
  };
}

function thread(id: string, messages: readonly Message[], lastReadAt: string | null = AT): Thread {
  return { id, pinId: `pin-${id}`, isResolved: false, messages, lastReadAt };
}

describe('unread comments acceptance', () => {
  it('excludes equal-time messages and an agent message operated by this person', () => {
    const equal = message('equal', AT, { mentions: [ME] });
    const agent = message('agent', LATER, {
      authorId: null,
      authorKind: 'agent',
      operatorId: ME,
      mentions: [ME],
    });
    const incoming = message('incoming', LATER);
    const item = thread('one', [equal, agent, incoming]);
    expect(unreadMessagesOf(item, ME).map(({ id }) => id)).toEqual(['incoming']);
    expect(unreadCommentsOf([item], ME)).toEqual({ threads: 1, mentions: 0 });
  });

  it('does not count mentions in messages already read even when a later reply is unread', () => {
    const item = thread('one', [message('mention', AT, { mentions: [ME] }), message('reply')]);
    expect(unreadCommentsOf([item], ME)).toEqual({ threads: 1, mentions: 0 });
  });

  it('chooses the first unread mention in service order, then the first plain unread', () => {
    const read = thread('read', [message('old', AT, { mentions: [ME] })]);
    const plain = thread('plain', [message('plain')]);
    const firstMention = thread('first-mention', [message('m1', LATER, { mentions: [ME] })]);
    const secondMention = thread('second-mention', [message('m2', LATER, { mentions: [ME] })]);
    expect(nextUnreadOf([read, plain, firstMention, secondMention], ME)?.id).toBe('first-mention');
    expect(nextUnreadOf([read, plain], ME)?.id).toBe('plain');
    expect(nextUnreadOf([read], ME)).toBeUndefined();
  });
});
