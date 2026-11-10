import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';
import { WIDE_NOTE_WIDTH } from '@canvas/tools';

import { VOTE_ORIGIN, voteBoardStore } from './__fixtures__/vote-board.js';
import { voteSession } from './__fixtures__/vote-session.js';
import { keepVoteRecord, RECORD_GAP, voteRecordOf } from './vote-record.js';

const RESULTS = [
  { objectId: 'over', count: 3 },
  { objectId: 'outside', count: 1 },
];

describe('voteRecordOf', () => {
  it('is a wide sticky of the results, right of the voted stickies and level with their top', () => {
    const { store } = voteBoardStore();
    const record = voteRecordOf(
      store.read(),
      voteSession({ status: 'revealed', results: RESULTS }),
    );
    expect(record?.pageId).toBe(DEFAULT_PAGE_ID);
    expect(record?.object).toMatchObject({
      type: 'sticky',
      parentId: null,
      // "outside" ends at 1000; "over" starts at y 100, "outside" at 0.
      x: 1000 + RECORD_GAP,
      y: 0,
      width: WIDE_NOTE_WIDTH,
      text: 'Vote results\n1. Fix bugs — 3 votes\n2. Untitled sticky — 1 vote',
      verticalAlign: 'top',
      align: 'left',
    });
    const text = record?.object.text ?? '';
    expect(record?.object.runs.map((run) => [run.length, run.style.fontSize])).toEqual([
      [text.length, 16],
    ]);
    expect(record?.object.height).toBe(200);
  });

  it('grows to its lines, and names a section', () => {
    const { store } = voteBoardStore();
    const many = Array.from({ length: 10 }, () => ({ objectId: 'over', count: 1 }));
    const tall = voteRecordOf(store.read(), voteSession({ results: many, scopeId: 'ideas' }));
    expect(tall?.object.text.split('\n')[0]).toBe('Vote results · Ideas');
    // 11 lines of 24 and 32 above and below.
    expect(tall?.object.height).toBe(11 * 24 + 64);
  });

  it('sits beside the section when no voted sticky is left, and is none with nothing to place by', () => {
    const { store } = voteBoardStore();
    const board = store.read();
    const empty = voteRecordOf(board, voteSession({ results: [], scopeId: 'ideas' }));
    expect(empty?.object).toMatchObject({
      x: 600 + RECORD_GAP,
      y: 0,
      text: 'Vote results · Ideas\nNo votes',
    });
    expect(voteRecordOf(board, voteSession({ results: [] }))).toBeUndefined();
    expect(
      voteRecordOf(board, voteSession({ results: [{ objectId: 'gone', count: 2 }] })),
    ).toBeUndefined();
    expect(voteRecordOf(board, voteSession({ results: null }))).toBeUndefined();
  });

  it('lists every voted sticky, however many (review)', () => {
    const { store } = voteBoardStore();
    const many = Array.from({ length: 12 }, () => ({ objectId: 'over', count: 1 }));
    const record = voteRecordOf(store.read(), voteSession({ results: many }));
    expect(record?.object.text.split('\n')).toHaveLength(13);
  });

  it('keeps the results when the section was deleted, beside the voted stickies (review)', () => {
    const { store } = voteBoardStore();
    const board = store.read();
    const objects = new Map([...board.objects].filter(([id]) => id !== 'ideas'));
    const results = [{ objectId: 'over', count: 3 }];
    const record = voteRecordOf({ ...board, objects }, voteSession({ results, scopeId: 'ideas' }));
    expect(record?.object).toMatchObject({
      x: 500 + RECORD_GAP,
      y: 100,
      text: 'Vote results\n1. Fix bugs — 3 votes',
    });
  });

  it('goes on the page of the stickies voted', () => {
    const { store, second } = voteBoardStore();
    const record = voteRecordOf(
      store.read(),
      voteSession({ results: [{ objectId: 'elsewhere', count: 2 }] }),
    );
    expect(record?.pageId).toBe(second);
  });
});

describe('keepVoteRecord', () => {
  it('creates the record as one undo step of the person, and nothing without one', () => {
    const { store } = voteBoardStore();
    const connection = { store, origin: VOTE_ORIGIN };
    expect(keepVoteRecord(connection, voteSession({ results: RESULTS }))).toBe(true);
    const records = [...store.read().objects.values()].filter(
      (object) => object.type === 'sticky' && object.text.startsWith('Vote results'),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ x: 1000 + RECORD_GAP, createdBy: VOTE_ORIGIN.principalId });
    expect(keepVoteRecord(connection, voteSession({ results: null }))).toBe(false);
    expect(store.get('gone' as ObjectId)).toBeUndefined();
  });
});
