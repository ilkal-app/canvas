// A mouse's or a pen's double press is decided on its release (fix round 1), as a
// finger's double-tap is: clicking an object and at once dragging it moves it; clicking it twice
// without moving activates it (edits a text, a note, a shape's label, a path).
import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { A, contextFor, FRAME_A, run } from './__fixtures__/select-tool-steps.js';
import type { SelectInput, SelectPointerType } from './select-input.js';
import { selectionOf } from './selection-state.js';

/**
 * A timed pointer input of one kind of pointer, the camera at the origin at 100%.
 *
 * @param pointerType - The pointer.
 * @param kind - Down, move or up.
 * @param point - The point, world units and CSS px alike.
 * @param timeStamp - When, ms.
 * @returns The input.
 */
function input(
  pointerType: SelectPointerType,
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  timeStamp: number,
): SelectInput {
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    timeStamp,
    pointerType,
  };
}

describe.each(['mouse', 'pen'] as const)('select tool: a %s double press', (pointerType) => {
  const at = { x: 50, y: 25 };
  const context = contextFor(selectionOf([A]), FRAME_A);
  const click = (point: Point, timeStamp: number): SelectInput[] => [
    input(pointerType, 'pointerDown', point, timeStamp),
    input(pointerType, 'pointerUp', point, timeStamp + 60),
  ];

  it('moves the object when the second press drags at once, activating nothing', () => {
    const { intents } = run(
      [
        ...click(at, 0),
        input(pointerType, 'pointerDown', at, 120),
        input(pointerType, 'pointerMove', { x: 80, y: 25 }, 140),
        input(pointerType, 'pointerUp', { x: 80, y: 25 }, 160),
      ],
      context,
    );
    expect(intents.map(({ type }) => type)).toEqual(['select', 'move', 'move', 'commit']);
    expect(intents.at(-2)).toMatchObject({ type: 'move', delta: { x: 30, y: 0 } });
  });

  it('activates nothing at the second press, and the object on its release', () => {
    const pressed = run([...click(at, 0), input(pointerType, 'pointerDown', at, 120)], context);
    expect(pressed.intents).toEqual([{ type: 'select', ids: [A] }]);
    const released = run([input(pointerType, 'pointerUp', at, 180)], context, pressed.state);
    expect(released.intents).toEqual([{ type: 'activate', id: A, world: at, pointerType }]);
  });

  it('activates when the second press stays inside the dead zone before its release', () => {
    const { intents } = run(
      [
        ...click(at, 0),
        input(pointerType, 'pointerDown', at, 120),
        input(pointerType, 'pointerMove', { x: 51, y: 26 }, 140),
        input(pointerType, 'pointerUp', { x: 51, y: 26 }, 160),
      ],
      context,
    );
    expect(intents).toEqual([
      { type: 'select', ids: [A] },
      { type: 'activate', id: A, world: at, pointerType },
    ]);
  });
});
