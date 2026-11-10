import { describe, expect, it } from 'vitest';

import type { Message, Thread } from '../comments/comment-api.js';

import { commentAge, searchComments } from './comment-search.js';

const CREATED_AT = '2026-01-01T09:00:00.000Z';

function message(id: string, authorName: string, text: string, createdAt = CREATED_AT): Message {
  return Object.freeze({
    id,
    authorId: id,
    authorName,
    text,
    mentions: Object.freeze([]),
    createdAt,
  });
}

function thread(
  id: string,
  messages: readonly Message[],
  isResolved = false,
  pinId = `${id}-pin`,
): Thread {
  return Object.freeze({ id, pinId, isResolved, messages: Object.freeze([...messages]) });
}

describe('searchComments', () => {
  it('matches message text and author name and uses the first matching message', () => {
    const first = message('one', 'Ana', 'Planning', '2026-01-01T08:00:00.000Z');
    const second = message('two', 'Béa', 'Try triage at 10?', '2026-01-01T08:30:00.000Z');
    const third = message('three', 'Ana', 'Triage again');
    const threads = Object.freeze([
      thread('text', [first, second, third]),
      thread('author', [message('four', 'Aná', 'Please review')]),
    ]);

    expect(searchComments(threads, 'TRIAGÉ', { shouldIncludeResolved: false })).toEqual([
      {
        threadId: 'text',
        pinId: 'text-pin',
        text: 'Béa: Try triage at 10?',
        createdAt: second.createdAt,
        isResolved: false,
      },
    ]);
    expect(searchComments(threads, 'ana', { shouldIncludeResolved: false })).toEqual([
      {
        threadId: 'text',
        pinId: 'text-pin',
        text: 'Ana: Planning',
        createdAt: first.createdAt,
        isResolved: false,
      },
      {
        threadId: 'author',
        pinId: 'author-pin',
        text: 'Aná: Please review',
        createdAt: CREATED_AT,
        isResolved: false,
      },
    ]);
  });

  it('excludes resolved threads by default and includes them when requested', () => {
    const threads = Object.freeze([
      thread('open', [message('one', 'Ana', 'Triage')]),
      thread('resolved', [message('two', 'Ana', 'Triage')], true),
    ]);
    expect(
      searchComments(threads, 'tri', { shouldIncludeResolved: false }).map((hit) => hit.threadId),
    ).toEqual(['open']);
    expect(
      searchComments(threads, 'tri', { shouldIncludeResolved: true }).map((hit) => hit.threadId),
    ).toEqual(['open', 'resolved']);
  });

  it('filters pins on the shown page while keeping thread order and frozen input unchanged', () => {
    const threads = Object.freeze([
      thread('first', [message('one', 'Ana', 'Triage')], false, 'other-page'),
      thread('second', [message('two', 'Ana', 'Triage')], false, 'shown-page'),
      thread('third', [message('three', 'Ana', 'Triage')], false, 'shown-page-too'),
    ]);
    expect(
      searchComments(threads, 'tri', {
        shouldIncludeResolved: false,
        isShown: (pinId) => pinId !== 'other-page',
      }).map((hit) => hit.threadId),
    ).toEqual(['second', 'third']);
    expect(
      searchComments(threads, 'tri', { shouldIncludeResolved: false }).map((hit) => hit.threadId),
    ).toEqual(['first', 'second', 'third']);
    expect(threads.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('returns no hits for a blank query', () => {
    const threads = [thread('one', [message('one', 'Ana', 'Triage')])];
    expect(searchComments(threads, ' \t ', { shouldIncludeResolved: true })).toEqual([]);
  });
});

describe('commentAge', () => {
  const now = Date.parse(CREATED_AT);

  it.each([
    [0, 'now'],
    [59_999, 'now'],
    [60_000, '1 m'],
    [5 * 60_000 + 59_000, '5 m'],
    [60 * 60_000, '1 h'],
    [23 * 60 * 60_000 + 59 * 60_000, '23 h'],
    [24 * 60 * 60_000, '1 d'],
    [3 * 24 * 60 * 60_000 + 23 * 60 * 60_000, '3 d'],
  ])('floors an age of %i milliseconds to %s', (elapsed, label) => {
    expect(commentAge(new Date(now - elapsed).toISOString(), now)).toBe(label);
  });

  it('uses now for future times and an empty string for unparsable times', () => {
    expect(commentAge(new Date(now + 60_000).toISOString(), now)).toBe('now');
    expect(commentAge('not a time', now)).toBe('');
  });
});
