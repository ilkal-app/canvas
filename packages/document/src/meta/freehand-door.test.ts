import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door judges a freehand stroke's `strokePoints` as coordinates and its
// `strokePressures` as values in [0, 1], by their keys, as it judges a line's ends.

/**
 * Checks a raw write of one key into an object's map, by the fixture writer.
 *
 * @param key - The stored key.
 * @param value - The value written.
 * @returns The verdict.
 */
function verdictOf(key: string, value: unknown): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  try {
    const update = rawUpdate(board, (objects) => {
      objects.get('shape-box')?.set(key, value);
    });
    return new UpdateStampCheck(board.hub).check(update);
  } finally {
    board.hub.destroy();
    board.writer.destroy();
  }
}

describe('the door on a freehand stroke’s arrays', () => {
  it.each([
    ['strokePoints', [0, 0, 40.5, -12]],
    ['strokePressures', [0, 0.5, 1]],
  ])('accepts %s %j', (key, value) => {
    expect(verdictOf(key, value)).toEqual({ kind: 'accepted' });
  });

  it.each([
    ['strokePoints', [0, Number.NaN], '1', 'not-finite'],
    ['strokePoints', [0, 'x'], '1', 'not-a-number'],
    ['strokePoints', { x: 0 }, '', 'not-a-record'],
    ['strokePressures', [0.5, 2], '1', 'out-of-range'],
  ])('refuses %s %j at %s', (key, value, field, reason) => {
    expect(verdictOf(key, value)).toEqual({
      kind: 'accepted',
      hostileValue: expect.objectContaining({ key, field, reason }) as unknown,
    });
  });
});
