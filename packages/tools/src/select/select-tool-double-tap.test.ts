import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { A, B, contextFor, FRAME_A, run } from './__fixtures__/select-tool-steps.js';
import { finger, hold } from './__fixtures__/touch-inputs.js';
import type { SelectInput } from './select-input.js';
import { IDLE_SELECT_TOOL } from './select-tool.js';
import { selectionOf } from './selection-state.js';
import { LONG_PRESS_MS } from './touch-gestures.js';

// A finger's double-tap: main's double press with a 32 px slop,
// decided on the second lift.

describe('select tool: double-tap', () => {
  const tap = (point: Point, timeStamp: number): SelectInput[] => [
    finger('pointerDown', point, timeStamp),
    finger('pointerUp', point, timeStamp + 50),
  ];

  it('activates the object a finger taps twice, as a double click does, 32 px apart', () => {
    const { intents } = run(
      [...tap({ x: 10, y: 10 }, 0), ...tap({ x: 40, y: 10 }, 300)],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([
      { type: 'select', ids: [A] },
      { type: 'activate', id: A, world: { x: 40, y: 10 }, pointerType: 'touch' },
    ]);
  });

  it('decides on the second lift: the second press alone activates nothing', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const pressed = run(
      [...tap({ x: 50, y: 25 }, 0), finger('pointerDown', { x: 50, y: 25 }, 200)],
      context,
    );
    expect(pressed.intents).toEqual([{ type: 'select', ids: [A] }]);
    const lifted = run([finger('pointerUp', { x: 50, y: 25 }, 250)], context, pressed.state);
    expect(lifted.intents).toEqual([
      { type: 'activate', id: A, world: { x: 50, y: 25 }, pointerType: 'touch' },
    ]);
  });

  it('moves the object when the second press drags, activating nothing', () => {
    const { intents } = run(
      [
        ...tap({ x: 50, y: 25 }, 0),
        finger('pointerDown', { x: 50, y: 25 }, 200),
        finger('pointerMove', { x: 70, y: 25 }, 250),
        finger('pointerUp', { x: 70, y: 25 }, 300),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.map(({ type }) => type)).toEqual(['select', 'move', 'move', 'commit']);
  });

  it('opens the menu when the second press is held, activating nothing', () => {
    const { intents } = run(
      [
        ...tap({ x: 50, y: 25 }, 0),
        finger('pointerDown', { x: 50, y: 25 }, 200),
        hold(200 + LONG_PRESS_MS, { x: 50, y: 25 }),
        finger('pointerUp', { x: 50, y: 25 }, 900),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.map(({ type }) => type)).toEqual(['select', 'contextMenu']);
  });

  it('counts a frame’s background as empty board: a double-tap there fits the board', () => {
    const { intents } = run(
      [...tap({ x: 500, y: 200 }, 0), ...tap({ x: 510, y: 205 }, 300)],
      contextFor(),
    );
    expect(intents).toEqual([
      { type: 'select', ids: [] },
      { type: 'doubleTap', fit: 'board' },
    ]);
  });

  it('asks for a zoom to fit the board when a finger taps empty board twice', () => {
    const { intents, state } = run(
      [...tap({ x: 150, y: 200 }, 0), ...tap({ x: 170, y: 210 }, 300)],
      contextFor(),
    );
    expect(intents).toEqual([
      { type: 'select', ids: [] },
      { type: 'doubleTap', fit: 'board' },
    ]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('fits the selection instead when one is left (a Shift tap keeps it)', () => {
    const { intents } = run(
      [...tap({ x: 150, y: 200 }, 0), ...tap({ x: 150, y: 200 }, 300)],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.at(-1)).toEqual({ type: 'doubleTap', fit: 'selection' });
  });

  it('pans, not zooms, when the second tap drags', () => {
    const { intents } = run(
      [
        ...tap({ x: 150, y: 200 }, 0),
        finger('pointerDown', { x: 150, y: 200 }, 300),
        finger('pointerMove', { x: 350, y: 30 }, 350),
        finger('pointerUp', { x: 350, y: 30 }, 400),
      ],
      contextFor(),
    );
    expect(intents.map(({ type }) => type)).toEqual(['select', 'pan']);
  });

  it('pairs nothing for a mouse on empty board, nor taps 400 ms apart, nor after a long-press', () => {
    const mouse = (kind: 'pointerDown' | 'pointerUp', timeStamp: number): SelectInput => ({
      kind,
      screen: { x: 150, y: 200 },
      world: { x: 150, y: 200 },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp,
    });
    const clicks = [mouse('pointerDown', 0), mouse('pointerUp', 50)];
    const twice = run(
      [...clicks, mouse('pointerDown', 200), mouse('pointerUp', 250)],
      contextFor(),
    );
    expect(twice.intents.map(({ type }) => type)).toEqual(['select', 'select']);
    const late = run(
      [...tap({ x: 150, y: 200 }, 0), ...tap({ x: 150, y: 200 }, 401)],
      contextFor(),
    );
    expect(late.intents.map(({ type }) => type)).toEqual(['select', 'select']);
    const held = run(
      [
        finger('pointerDown', { x: 150, y: 200 }, 0),
        hold(LONG_PRESS_MS, { x: 150, y: 200 }),
        ...tap({ x: 150, y: 200 }, LONG_PRESS_MS + 100),
      ],
      contextFor(),
    );
    expect(held.intents.map(({ type }) => type)).toEqual(['select', 'contextMenu', 'select']);
  });

  it('leaves one level on the first tap only, not again on the second', () => {
    const inner = { ...IDLE_SELECT_TOOL, enteredGroupId: B };
    const first = run(
      tap({ x: 150, y: 200 }, 0),
      contextFor(undefined, undefined, { outerGroupId: A }),
      inner,
    );
    expect(first.state.enteredGroupId).toBe(A);
    const second = run(tap({ x: 150, y: 200 }, 300), contextFor(), first.state);
    expect(second.state.enteredGroupId).toBe(A);
    expect(second.intents).toEqual([{ type: 'doubleTap', fit: 'board' }]);
  });
});
