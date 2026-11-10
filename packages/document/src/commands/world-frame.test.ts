import { describe, expect, it } from 'vitest';

import { createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import { boardToParentFrame, parentFrameToBoard, unlessParentCycle } from './world-frame.js';

describe('board and parent frames', () => {
  it('maps points between the board and the frame of an object in a frame', () => {
    const board = createFixtureStore().read();
    const title = board.objects.get(id('text-title'));
    if (title === undefined) throw new Error('no title');
    // The frame's origin is at (-400, -300) on the board.
    expect(parentFrameToBoard(board, title, { x: 40, y: 40 })).toEqual({ x: -360, y: -260 });
    expect(boardToParentFrame(board, title, { x: -360, y: -260 })).toEqual({ x: 40, y: 40 });
  });

  it("turns the schema's parent-cycle RangeError into null and lets other errors through", () => {
    expect(unlessParentCycle(() => 1)).toBe(1);
    expect(
      unlessParentCycle(() => {
        throw new RangeError('cycle');
      }),
    ).toBeNull();
    expect(() =>
      unlessParentCycle(() => {
        throw new TypeError('bug');
      }),
    ).toThrow(TypeError);
  });
});
