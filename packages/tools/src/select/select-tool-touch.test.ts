import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import {
  A,
  B,
  contextFor,
  FRAME_A,
  FRAME_AB,
  run,
  pointer,
} from './__fixtures__/select-tool-steps.js';
import { finger, hold } from './__fixtures__/touch-inputs.js';
import type { SelectInput } from './select-input.js';
import { CLICK_THRESHOLD_PX, clickThresholdPx, IDLE_SELECT_TOOL } from './select-tool.js';
import { selectionOf } from './selection-state.js';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './touch-gestures.js';

describe('select tool: one finger', () => {
  it('taps to select, as a click does', () => {
    const { intents, state } = run(
      [finger('pointerDown', { x: 10, y: 10 }, 0), finger('pointerUp', { x: 12, y: 10 }, 80)],
      contextFor(),
    );
    expect(intents).toEqual([{ type: 'select', ids: [A] }]);
    expect(state.phase).toBe('idle');
  });

  it('waits for 8 px of travel before dragging, twice the mouse’s threshold', () => {
    expect(clickThresholdPx('touch')).toBe(LONG_PRESS_SLOP_PX);
    expect(clickThresholdPx('mouse')).toBe(CLICK_THRESHOLD_PX);
    const context = contextFor(selectionOf([A]), FRAME_A);
    // The middle of a (100 × 50), clear of every finger's handle square.
    const wobble = run(
      [finger('pointerDown', { x: 50, y: 25 }), finger('pointerMove', { x: 57.5, y: 25 })],
      context,
    );
    expect(wobble.state.phase).toBe('pressing');
    const drag = run([finger('pointerMove', { x: 58, y: 25 })], context, wobble.state);
    expect(drag.state.phase).toBe('dragging');
    expect(drag.intents).toEqual([{ type: 'move', delta: { x: 8, y: 0 }, isAxisLocked: false }]);
  });

  it('pans empty board by each finger movement and keeps the selection', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const { intents, state } = run(
      [
        finger('pointerDown', { x: 150, y: 100 }),
        finger('pointerMove', { x: 140, y: 91 }),
        finger('pointerMove', { x: 100, y: 70 }),
        finger('pointerUp', { x: 90, y: 60 }),
      ],
      context,
    );
    expect(intents).toEqual([
      { type: 'pan', deltaXPx: -10, deltaYPx: -9 },
      { type: 'pan', deltaXPx: -40, deltaYPx: -21 },
      { type: 'pan', deltaXPx: -10, deltaYPx: -10 },
    ]);
    expect(state.phase).toBe('idle');
    expect(context.selection.ids).toEqual([A]);
  });

  it('pans the whole stretch when only the release crosses the touch slop', () => {
    const { intents, state } = run(
      [finger('pointerDown', { x: 150, y: 100 }), finger('pointerUp', { x: 110, y: 70 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([{ type: 'pan', deltaXPx: -40, deltaYPx: -30 }]);
    expect(state.phase).toBe('idle');
  });

  it('pans from a frame background with a finger', () => {
    const { intents } = run(
      [finger('pointerDown', { x: 450, y: 150 }), finger('pointerMove', { x: 470, y: 170 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([{ type: 'pan', deltaXPx: 20, deltaYPx: 20 }]);
  });

  it.each(['mouse', 'pen'] as const)('keeps the %s marquee on empty board', (pointerType) => {
    const inputs = [
      pointer('pointerDown', { x: 150, y: 100 }),
      pointer('pointerMove', { x: 350, y: 30 }),
      pointer('pointerUp', { x: 350, y: 30 }),
    ].map((input) => ({ ...input, pointerType }));
    const { intents } = run(inputs, contextFor());
    expect(intents.map(({ type }) => type)).toEqual(['marquee', 'marquee', 'commit']);
  });

  it('abandons a finger pan on pointer cancel without restoring or clearing selection', () => {
    const { intents, state } = run(
      [
        finger('pointerDown', { x: 150, y: 100 }),
        finger('pointerMove', { x: 130, y: 90 }),
        { kind: 'pointerCancel' },
        finger('pointerUp', { x: 130, y: 90 }),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([{ type: 'pan', deltaXPx: -20, deltaYPx: -10 }]);
    expect(state.phase).toBe('idle');
  });

  it('forgets a prior empty-board tap after a pan', () => {
    const context = contextFor();
    const first = run(
      [finger('pointerDown', { x: 150, y: 100 }, 0), finger('pointerUp', { x: 150, y: 100 }, 50)],
      context,
    );
    const pan = run(
      [
        finger('pointerDown', { x: 150, y: 100 }, 100),
        finger('pointerMove', { x: 170, y: 100 }, 120),
        finger('pointerUp', { x: 170, y: 100 }, 140),
      ],
      context,
      first.state,
    );
    const tap = run(
      [
        finger('pointerDown', { x: 171, y: 100 }, 180),
        finger('pointerUp', { x: 171, y: 100 }, 200),
      ],
      context,
      pan.state,
    );
    expect(tap.intents).toEqual([{ type: 'select', ids: [] }]);
  });

  it('grabs a resize handle 30 px out of its corner with a finger', () => {
    const { state } = run(
      [finger('pointerDown', { x: 130, y: 80 }), finger('pointerMove', { x: 150, y: 100 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(state.phase === 'dragging' && state.drag).toMatchObject({
      kind: 'resize',
      handle: 'se',
    });
  });
});

describe('select tool: long-press', () => {
  it('opens the context menu at the finger after 500 ms held in place', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const pressed = run([finger('pointerDown', { x: 10, y: 10 }, 1_000)], context);
    const early = run([hold(1_000 + LONG_PRESS_MS - 1)], context, pressed.state);
    expect(early).toEqual({ state: pressed.state, intents: [] });
    const held = run([hold(1_000 + LONG_PRESS_MS)], context, pressed.state);
    expect(held.state).toBe(IDLE_SELECT_TOOL);
    expect(held.intents).toEqual([
      // A finger's long-press says so.
      { type: 'contextMenu', screen: { x: 10, y: 10 }, world: { x: 10, y: 10 }, isTouch: true },
    ]);
  });

  it('keeps the multi-selection it was pressed on, and selects an unselected object first', () => {
    const multi = contextFor(selectionOf([A, B]), FRAME_AB);
    const onSelected = run(
      [finger('pointerDown', { x: 210, y: 10 }), hold(LONG_PRESS_MS, { x: 210, y: 10 })],
      multi,
    ).intents;
    expect(onSelected.map(({ type }) => type)).toEqual(['contextMenu']);
    const onUnselected = run(
      [finger('pointerDown', { x: 210, y: 10 }), hold(LONG_PRESS_MS, { x: 210, y: 10 })],
      {
        ...multi,
        selection: selectionOf([A]),
        frame: FRAME_A,
      },
    ).intents;
    expect(onUnselected.map(({ type }) => type)).toEqual(['select', 'contextMenu']);
  });

  it('clears the selection on empty board, so the menu offers the board’s commands', () => {
    const { intents } = run(
      [finger('pointerDown', { x: 150, y: 400 }), hold(LONG_PRESS_MS, { x: 150, y: 400 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.map(({ type }) => type)).toEqual(['select', 'contextMenu']);
    expect(intents[0]).toEqual({ type: 'select', ids: [] });
  });

  it('is no long-press once the finger moved 8 px: that is a drag', () => {
    const { intents, state } = run(
      [
        finger('pointerDown', { x: 10, y: 10 }),
        finger('pointerMove', { x: 10, y: 10 + LONG_PRESS_SLOP_PX }),
        hold(LONG_PRESS_MS),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(state.phase).toBe('dragging');
    expect(intents.some(({ type }) => type === 'contextMenu')).toBe(false);
  });

  it('opens the menu after a wobble under 8 px', () => {
    const { intents } = run(
      [
        finger('pointerDown', { x: 10, y: 10 }),
        finger('pointerMove', { x: 15, y: 15 }),
        hold(LONG_PRESS_MS),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.map(({ type }) => type)).toEqual(['contextMenu']);
  });

  it('is at rest once the menu is open, so the finger lifting clicks nothing', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const held = run(
      [finger('pointerDown', { x: 210, y: 10 }), hold(LONG_PRESS_MS, { x: 210, y: 10 })],
      context,
    );
    expect(held.state).toBe(IDLE_SELECT_TOOL);
    const after = run([finger('pointerUp', { x: 210, y: 10 })], context, held.state);
    expect(after).toEqual({ state: IDLE_SELECT_TOOL, intents: [] });
  });

  it('is no long-press once a press on the count badge has wandered 8 px', () => {
    // Above the outline cap the frame shows a count badge; a press there drags nothing, so
    // only the hold's own position tells a finger held in place from one that wandered.
    const context = contextFor(selectionOf([A]), FRAME_A);
    const pressed = run([finger('pointerDown', { x: 10, y: 10 })], context);
    const badge = { ...pressed.state, target: { kind: 'badge' as const } };
    const wandered = run(
      [finger('pointerMove', { x: 10, y: 18 }), hold(LONG_PRESS_MS, { x: 10, y: 18 })],
      context,
      badge,
    );
    expect(wandered.intents).toEqual([]);
    const inPlace = run([hold(LONG_PRESS_MS, { x: 10, y: 17.5 })], context, badge);
    expect(inPlace.intents.map(({ type }) => type)).toEqual(['contextMenu']);
  });

  it('never long-presses with a mouse', () => {
    const mouseDown: SelectInput = {
      kind: 'pointerDown',
      screen: { x: 10, y: 10 },
      world: { x: 10, y: 10 },
      isShiftPressed: false,
      isModPressed: false,
      pointerType: 'mouse',
      timeStamp: 0,
    };
    const { state } = run([mouseDown, hold(LONG_PRESS_MS * 2)], contextFor());
    expect(state.phase).toBe('pressing');
  });

  it('a second finger cancels the press without a click or a menu', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const { intents, state } = run(
      [finger('pointerDown', { x: 210, y: 10 }), { kind: 'pointerCancel' }, hold(LONG_PRESS_MS)],
      context,
    );
    expect(intents).toEqual([{ type: 'select', ids: [A, B] }]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('a second finger puts back the selection the first finger’s press changed', () => {
    const { intents } = run(
      [finger('pointerDown', { x: 210, y: 10 }), { kind: 'pointerCancel' }],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([
      { type: 'select', ids: [B] },
      { type: 'select', ids: [A] },
    ]);
  });
});

describe('select tool: secondary click', () => {
  const rightClick = (point: Point): SelectInput => ({
    kind: 'contextPress',
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
  });

  it('selects an unselected object and opens the menu there, staying at rest', () => {
    const { intents, state } = run([rightClick({ x: 210, y: 10 })], contextFor());
    expect(intents).toEqual([
      { type: 'select', ids: [B] },
      { type: 'contextMenu', screen: { x: 210, y: 10 }, world: { x: 210, y: 10 } },
    ]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('keeps a multi-selection when it lands on one of its objects', () => {
    const { intents } = run(
      [rightClick({ x: 10, y: 10 })],
      contextFor(selectionOf([A, B]), FRAME_AB),
    );
    expect(intents.map(({ type }) => type)).toEqual(['contextMenu']);
  });

  it('ends a press it interrupts (Control-click on a Mac) without its click', () => {
    const control: SelectInput = {
      kind: 'pointerDown',
      screen: { x: 210, y: 10 },
      world: { x: 210, y: 10 },
      isShiftPressed: false,
      isModPressed: true,
    };
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const { intents, state } = run([control, rightClick({ x: 210, y: 10 })], context);
    expect(intents.map(({ type }) => type)).toEqual(['contextMenu']);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('does nothing mid-drag', () => {
    const drag = run(
      [finger('pointerDown', { x: 10, y: 10 }), finger('pointerMove', { x: 40, y: 10 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    const { intents } = run([rightClick({ x: 40, y: 10 })], contextFor(), drag.state);
    expect(intents).toEqual([]);
  });
});
