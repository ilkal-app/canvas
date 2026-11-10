import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

const check = (key: string, value: unknown) => {
  const board = fixtureGateBoard();
  try {
    const update = rawUpdate(board, (objects, doc) => {
      doc.getMap('pages').set(key, value);
    });
    return new UpdateStampCheck(board.hub).check(update);
  } finally {
    board.hub.destroy();
    board.writer.destroy();
  }
};

describe('hostile page admission', () => {
  it.each([
    ['p.identity', { id: 'p', createdBy: 'user:ada', createdAt: 1 }],
    ['page-1.identity', { id: 'page-1', createdBy: null, createdAt: 0 }],
    ['p.name', 'x'.repeat(200)],
    ['p.order', 'a0'],
  ])('accepts valid key %s', (key, value) => {
    expect(check(key, value)).toEqual({ kind: 'accepted' });
  });
  it.each([
    ['p.identity', { id: 'different', createdBy: null, createdAt: 0 }],
    ['p.name', 'x'.repeat(201)],
    ['p.name', 5],
    ['p.order', 'bad key'],
    ['p.extra', true],
    ['invalid key.name', 'x'],
  ])('refuses hostile page value %s', (key, value) => {
    const verdict = check(key, value);
    expect('hostileValue' in verdict || verdict.kind !== 'accepted').toBe(true);
  });
  it.each([17, {}, [], 'bad page id'])('rejects malformed placement pageId %j', (pageId) => {
    const board = fixtureGateBoard();
    try {
      const update = rawUpdate(board, (objects) => {
        mergeGroup(objects, 'shape-box', 'placement', { pageId });
      });
      const verdict = new UpdateStampCheck(board.hub).check(update);
      expect('hostileValue' in verdict || verdict.kind !== 'accepted').toBe(true);
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });
  it('accepts a reference to a deleted page for lossless repair, without counting pages', () => {
    const board = fixtureGateBoard();
    try {
      const update = rawUpdate(board, (objects, doc) => {
        mergeGroup(objects, 'shape-box', 'placement', { pageId: 'deleted-page' });
        for (let i = 0; i < 101; i++) {
          const id = `p-${String(i)}`;
          doc.getMap('pages').set(`${id}.identity`, { id, createdBy: null, createdAt: 0 });
          doc.getMap('pages').set(`${id}.name`, id);
          doc.getMap('pages').set(`${id}.order`, 'a0');
        }
      });
      expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });
});
