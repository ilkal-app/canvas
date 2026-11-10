import { describe, expect, it } from 'vitest';

import { coalescePointerInputs, type PointerInput } from './pointer-input.js';

function input(
  type: PointerInput['type'],
  xPx: number,
  overrides: Partial<PointerInput> = {},
): PointerInput {
  return { type, xPx, yPx: 0, buttons: 0, pointerId: 1, timestampMs: xPx, ...overrides };
}

describe('coalescePointerInputs', () => {
  it('keeps only the last of consecutive moves of one pointer, with its own timestamp', () => {
    const moves = [input('move', 1), input('move', 2), input('move', 3)];
    expect(coalescePointerInputs(moves)).toEqual([input('move', 3)]);
  });

  it('keeps every press, release and cancel, and the move before each', () => {
    const inputs = [
      input('move', 1),
      input('move', 2),
      input('down', 3, { buttons: 1 }),
      input('move', 4, { buttons: 1 }),
      input('move', 5, { buttons: 1 }),
      input('up', 6),
      input('cancel', 7),
    ];
    expect(coalescePointerInputs(inputs).map(({ type, xPx }) => [type, xPx])).toEqual([
      ['move', 2],
      ['down', 3],
      ['move', 5],
      ['up', 6],
      ['cancel', 7],
    ]);
  });

  it('keeps a move whose buttons differ from the next move, so a button transition survives', () => {
    const inputs = [
      input('move', 1, { buttons: 1 }),
      input('move', 2, { buttons: 3 }),
      input('move', 3, { buttons: 3 }),
    ];
    expect(coalescePointerInputs(inputs).map(({ xPx, buttons }) => [xPx, buttons])).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('coalesces each pointer separately and keeps the order of what remains', () => {
    const inputs = [
      input('move', 1, { pointerId: 1 }),
      input('move', 10, { pointerId: 2 }),
      input('move', 2, { pointerId: 1 }),
      input('up', 11, { pointerId: 2 }),
    ];
    expect(coalescePointerInputs(inputs).map(({ pointerId, xPx }) => [pointerId, xPx])).toEqual([
      [2, 10],
      [1, 2],
      [2, 11],
    ]);
  });

  it('returns a new list and leaves its input untouched', () => {
    const inputs = Object.freeze([input('move', 1), input('move', 2)]);
    const result = coalescePointerInputs(inputs);
    expect(result).not.toBe(inputs);
    expect(inputs).toHaveLength(2);
    expect(coalescePointerInputs([])).toEqual([]);
  });
});
