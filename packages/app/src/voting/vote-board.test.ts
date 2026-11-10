import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_ID, type BoardObject, type ObjectId } from '@canvas/schema';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { voteSession } from './__fixtures__/vote-session.js';
import {
  isInVoteScope,
  rankedStickiesOf,
  sectionNameOf,
  stickyAt,
  stickyLabelOf,
  voteResultsText,
  voteScopeOf,
  votesWord,
} from './vote-board.js';

const ids = (...names: string[]): ObjectId[] => names as ObjectId[];

/**
 * An object of the fixture's board, which must be there.
 *
 * @param store - The board.
 * @param store.get - Its read.
 * @param id - The object.
 * @returns It.
 * @throws {Error} When it is not there.
 */
function objectOf(
  store: { get: (id: ObjectId) => BoardObject | undefined },
  id: string,
): BoardObject {
  const object = store.get(id as ObjectId);
  if (object === undefined) throw new Error(`No ${id}.`);
  return object;
}

describe('voteScopeOf', () => {
  it('is the one selected frame, else the whole board', () => {
    const { store } = voteBoardStore();
    expect(voteScopeOf(store, ids('ideas'))).toBe('ideas');
    expect(voteScopeOf(store, ids('over'))).toBeNull();
    expect(voteScopeOf(store, ids('ideas', 'over'))).toBeNull();
    expect(voteScopeOf(store, [])).toBeNull();
  });
});

describe('sectionNameOf', () => {
  it('is the frame’s name, "Section" when it has none, and none when the frame is gone', () => {
    const { store } = voteBoardStore();
    expect(sectionNameOf(store, 'ideas')).toBe('Ideas');
    expect(
      sectionNameOf(
        {
          get: (id) => (id === 'blank' ? { ...objectOf(store, 'ideas'), name: '  ' } : undefined),
        },
        'blank',
      ),
    ).toBe('Section');
    expect(sectionNameOf(store, 'over')).toBeUndefined();
    expect(sectionNameOf(store, 'gone')).toBeUndefined();
  });
});

describe('isInVoteScope', () => {
  it('takes anything in a board-wide vote', () => {
    const { store } = voteBoardStore();
    expect(isInVoteScope(store, 'outside', null)).toBe(true);
    expect(isInVoteScope(store, 'not-a-sticky', undefined)).toBe(true);
  });

  it('takes a section’s child and a root sticky over it on its page, nothing else', () => {
    const { store } = voteBoardStore();
    expect(isInVoteScope(store, 'inside', 'ideas')).toBe(true);
    expect(isInVoteScope(store, 'over', 'ideas')).toBe(true);
    expect(isInVoteScope(store, 'outside', 'ideas')).toBe(false);
    expect(isInVoteScope(store, 'elsewhere', 'ideas')).toBe(false);
    expect(isInVoteScope(store, 'ideas', 'ideas')).toBe(false);
    expect(isInVoteScope(store, 'gone', 'ideas')).toBe(false);
  });

  it('takes a sticky nested elsewhere by its parent, never by where it sits (review)', () => {
    const { store } = voteBoardStore();
    // A small root frame on the same page holds "over", placed where the section is.
    const side = { ...objectOf(store, 'ideas'), id: 'side' as ObjectId, width: 10, height: 10 };
    const nested = { ...objectOf(store, 'over'), parentId: 'side' as ObjectId };
    const reader = {
      get: (id: ObjectId) => (id === 'side' ? side : id === 'over' ? nested : store.get(id)),
    };
    expect(isInVoteScope(reader, 'over', 'ideas')).toBe(false);
    expect(isInVoteScope(reader, 'over', 'side')).toBe(true);
  });

  it('takes nothing once the section is gone, or is not a frame', () => {
    const { store } = voteBoardStore();
    expect(isInVoteScope(store, 'inside', 'gone')).toBe(false);
    expect(isInVoteScope(store, 'inside', 'over')).toBe(false);
  });

  it('walks no further than a broken parent chain', () => {
    const { store } = voteBoardStore();
    const looped = { ...objectOf(store, 'over'), parentId: 'over' as ObjectId };
    const reader = {
      get: (id: ObjectId) => (id === 'over' ? looped : store.get(id)),
    };
    expect(isInVoteScope(reader, 'over', 'ideas')).toBe(false);
  });
});

describe('stickyLabelOf', () => {
  it('is the first non-empty line, shortened, or "Untitled sticky"', () => {
    expect(stickyLabelOf('\n  Ship it  \nnow')).toBe('Ship it');
    expect(stickyLabelOf('')).toBe('Untitled sticky');
    expect(stickyLabelOf('a'.repeat(50))).toBe(`${'a'.repeat(39)}…`);
    expect(stickyLabelOf('a'.repeat(40))).toBe('a'.repeat(40));
  });
});

describe('rankedStickiesOf', () => {
  const results = [
    { objectId: 'over', count: 4 },
    { objectId: 'gone', count: 3 },
    { objectId: 'inside', count: 2 },
    { objectId: 'ideas', count: 2 },
    { objectId: 'outside', count: 1 },
    { objectId: 'elsewhere', count: 0 },
  ];

  it('ranks the voted stickies left, by their labels, most first', () => {
    const { store } = voteBoardStore();
    expect(rankedStickiesOf(store, voteSession({ results }))).toEqual([
      { id: 'over', label: 'Fix bugs', count: 4 },
      { id: 'inside', label: 'Ship it', count: 2 },
      { id: 'outside', label: 'Untitled sticky', count: 1 },
    ]);
    expect(rankedStickiesOf(store, voteSession({ results }), 1)).toHaveLength(1);
  });

  it('ranks everything counted once the section is deleted (review)', () => {
    const { store } = voteBoardStore();
    const reader = { get: (id: ObjectId) => (id === 'ideas' ? undefined : store.get(id)) };
    const scoped = voteSession({ results, scopeId: 'ideas' });
    expect(rankedStickiesOf(reader, scoped).map(({ id }) => id)).toEqual([
      'over',
      'inside',
      'outside',
    ]);
  });

  it('keeps a section’s stickies only, and none while the results are hidden', () => {
    const { store } = voteBoardStore();
    const scoped = voteSession({ results, scopeId: 'ideas' });
    expect(rankedStickiesOf(store, scoped).map(({ id }) => id)).toEqual(['over', 'inside']);
    expect(rankedStickiesOf(store, voteSession())).toEqual([]);
  });
});

describe('voteResultsText', () => {
  it('titles the record, with its section, and lists the stickies by rank', () => {
    const ranked = [
      { id: 'over', label: 'Fix bugs', count: 4 },
      { id: 'inside', label: 'Ship it', count: 1 },
    ];
    expect(voteResultsText(ranked)).toBe(
      'Vote results\n1. Fix bugs — 4 votes\n2. Ship it — 1 vote',
    );
    expect(voteResultsText([], 'Ideas')).toBe('Vote results · Ideas\nNo votes');
    expect(votesWord(1)).toBe('1 vote');
  });
});

describe('stickyAt', () => {
  it('is the topmost sticky of the page under a point', () => {
    const { store, second } = voteBoardStore();
    const board = store.read();
    expect(stickyAt(board, { x: 350, y: 150 }, 1, DEFAULT_PAGE_ID)).toBe('over');
    expect(stickyAt(board, { x: 350, y: 150 }, 1, second)).toBe('elsewhere');
    expect(stickyAt(board, { x: 50, y: 50 }, 1, DEFAULT_PAGE_ID)).toBe('inside');
    expect(stickyAt(board, { x: 550, y: 380 }, 1, DEFAULT_PAGE_ID)).toBeUndefined();
    expect(stickyAt(board, { x: 900, y: 100 }, 1)).toBe('outside');
  });
});
