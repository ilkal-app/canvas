// CONTRACT: an ended vote's record grows with its ranked entries and uses the
// section as its anchor when every voted sticky has gone; a hidden reveal leaves no record.
import { expect, it } from 'vitest';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { voteSession } from './__fixtures__/vote-session.js';
import { RECORD_GAP, voteRecordOf } from './vote-record.js';

it('uses the minimum height for one ranked sticky and grows for ten', () => {
  const { store } = voteBoardStore();
  const one = voteRecordOf(
    store.read(),
    voteSession({ results: [{ objectId: 'over', count: 1 }] }),
  );
  expect(one?.object.height).toBe(200);
  const ten = voteRecordOf(
    store.read(),
    voteSession({ results: Array.from({ length: 10 }, () => ({ objectId: 'over', count: 1 })) }),
  );
  expect(ten?.object.text.split('\n')).toHaveLength(11);
  expect(ten?.object.height).toBe(328);
});

it('keeps the no-votes record beside a surviving section when its only voted sticky was deleted', () => {
  const { store } = voteBoardStore();
  const record = voteRecordOf(
    store.read(),
    voteSession({ scopeId: 'ideas', results: [{ objectId: 'deleted', count: 4 }] }),
  );
  expect(record?.object).toMatchObject({
    x: 600 + RECORD_GAP,
    y: 0,
    text: 'Vote results · Ideas\nNo votes',
    height: 200,
  });
  expect(voteRecordOf(store.read(), voteSession({ results: null }))).toBeUndefined();
});
