import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { fixtureGateBoard, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

const STICKY_AUTHORS_KEY = 'stickyAuthors';

/**
 * Checks a raw facilitation-map write at the relay door.
 *
 * @param key - The map key.
 * @param value - The value to write.
 * @returns The door's verdict.
 */
function verdict(key: string, value: unknown): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  try {
    const update = rawUpdate(board, (...args) => {
      const doc = args[1];
      doc.getMap('facilitation').set(key, value);
    });
    return new UpdateStampCheck(board.hub).check(update);
  } finally {
    board.hub.destroy();
    board.writer.destroy();
  }
}

describe('sticky authors at the facilitation door', () => {
  it.each([true, false])('accepts the plain boolean %s', (isShown) => {
    expect(verdict(STICKY_AUTHORS_KEY, isShown)).toEqual({ kind: 'accepted' });
  });

  it.each(['true', 1, null, { isShown: true }])('refuses the non-boolean value %j', (value) => {
    expect(verdict(STICKY_AUTHORS_KEY, value)).toMatchObject({
      hostileValue: { key: STICKY_AUTHORS_KEY, reason: 'not-a-facilitation-value' },
    });
  });

  it('continues to refuse other facilitation keys', () => {
    expect(verdict('unrecognized', true)).toMatchObject({
      hostileValue: { key: 'unrecognized', reason: 'not-a-facilitation-key' },
    });
  });

  it('refuses a nested shared type under stickyAuthors', () => {
    expect(verdict(STICKY_AUTHORS_KEY, new Y.Map<unknown>())).toMatchObject({
      hostileValue: { key: STICKY_AUTHORS_KEY, reason: 'not-a-plain-value' },
    });
  });
});
