import { describe, expect, it } from 'vitest';

import { A, contextFor, FRAME_A, run } from './__fixtures__/select-tool-steps.js';
import type { SelectInput, SelectPointerType } from './select-input.js';
import { selectionOf } from './selection-state.js';

function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  pointerType: SelectPointerType,
  timeStamp = 0,
): SelectInput {
  return {
    kind,
    screen: { x, y: 25 },
    world: { x, y: 25 },
    isShiftPressed: false,
    isModPressed: false,
    pointerType,
    timeStamp,
  };
}

describe.each(['mouse', 'pen', 'touch'] as const)('fast %s releases', (pointerType) => {
  const context = contextFor(selectionOf([A]), FRAME_A);

  it('commits the drop when only the release crosses the drag threshold', () => {
    const { state, intents } = run(
      [input('pointerDown', 50, pointerType), input('pointerUp', 90, pointerType)],
      context,
    );
    expect(state.phase).toBe('idle');
    expect(intents).toEqual([
      { type: 'move', delta: { x: 40, y: 0 }, isAxisLocked: false },
      { type: 'commit' },
    ]);
  });

  it('commits after several sub-threshold moves followed by a distant release', () => {
    const { intents } = run(
      [
        input('pointerDown', 50, pointerType),
        ...[50.5, 51, 51.5, 52].map((x) => input('pointerMove', x, pointerType)),
        input('pointerUp', 90, pointerType),
      ],
      context,
    );
    expect(intents).toEqual([
      { type: 'move', delta: { x: 40, y: 0 }, isAxisLocked: false },
      { type: 'commit' },
    ]);
  });

  it('does not activate the object when the second press is a fast drag', () => {
    const { intents } = run(
      [
        input('pointerDown', 50, pointerType, 0),
        input('pointerUp', 50, pointerType, 20),
        input('pointerDown', 50, pointerType, 100),
        input('pointerUp', 90, pointerType, 120),
      ],
      context,
    );
    expect(intents.slice(-2)).toEqual([
      { type: 'move', delta: { x: 40, y: 0 }, isAxisLocked: false },
      { type: 'commit' },
    ]);
    expect(intents.some(({ type }) => type === 'activate')).toBe(false);
  });
});
