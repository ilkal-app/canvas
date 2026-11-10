import { describe, expect, it } from 'vitest';

import {
  A,
  B,
  C,
  contextFor,
  FRAME_A,
  FRAME_AB,
  pointer,
  run,
} from './__fixtures__/select-tool-steps.js';
import type { SelectInput } from './select-input.js';
import {
  CLICK_THRESHOLD_PX,
  IDLE_SELECT_TOOL,
  NUDGE_DISTANCE,
  NUDGE_LARGE_DISTANCE,
} from './select-tool.js';
import { selectionOf } from './selection-state.js';

describe('select tool: clicks', () => {
  it('selects an unselected object at the press and does nothing more on release', () => {
    const press = run([pointer('pointerDown', { x: 10, y: 10 })], contextFor());
    expect(press.intents).toEqual([{ type: 'select', ids: [A] }]);
    const release = run([pointer('pointerUp', { x: 10, y: 10 })], contextFor(), press.state);
    expect(release).toEqual({ state: IDLE_SELECT_TOOL, intents: [] });
  });

  it('shift-press adds an unselected object at once', () => {
    const { intents } = run(
      [pointer('pointerDown', { x: 210, y: 10 }, true)],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([{ type: 'toggle', id: B }]);
  });

  it('shift-click removes a selected object on release, so a drag can still move it', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const press = run([pointer('pointerDown', { x: 210, y: 10 }, true)], context);
    expect(press.intents).toEqual([]);
    const { intents } = run([pointer('pointerUp', { x: 210, y: 10 }, true)], context, press.state);
    expect(intents).toEqual([{ type: 'toggle', id: B }]);
  });

  it('a click on one object of a selection narrows the selection to it on release', () => {
    const { intents } = run(
      [pointer('pointerDown', { x: 210, y: 10 }), pointer('pointerUp', { x: 212, y: 11 })],
      contextFor(selectionOf([A, B]), FRAME_AB),
    );
    expect(intents).toEqual([{ type: 'select', ids: [B] }]);
  });

  it('a click on empty board clears the selection; with Shift it keeps it', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const click = [
      pointer('pointerDown', { x: 150, y: 400 }),
      pointer('pointerUp', { x: 150, y: 400 }),
    ];
    expect(run(click, context).intents).toEqual([{ type: 'select', ids: [] }]);
    const shiftClick = [
      pointer('pointerDown', { x: 150, y: 400 }, true),
      pointer('pointerUp', { x: 150, y: 400 }, true),
    ];
    expect(run(shiftClick, context).intents).toEqual([]);
  });

  it('treats a wobble under the click threshold as a click, not a drag', () => {
    const wobble = CLICK_THRESHOLD_PX - 0.5;
    const { intents } = run(
      [
        pointer('pointerDown', { x: 10, y: 10 }),
        pointer('pointerMove', { x: 10 + wobble, y: 10 }),
        pointer('pointerUp', { x: 10 + wobble, y: 10 }),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([{ type: 'select', ids: [A] }]);
  });

  it('does nothing when a handle is pressed and released without a drag', () => {
    const { state, intents } = run(
      [pointer('pointerDown', { x: 100, y: 50 }), pointer('pointerUp', { x: 100, y: 50 })],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect({ state, intents }).toEqual({ state: IDLE_SELECT_TOOL, intents: [] });
  });

  it('ignores a second press while the first is held', () => {
    const context = contextFor();
    const first = run([pointer('pointerDown', { x: 10, y: 10 })], context);
    const second = run([pointer('pointerDown', { x: 210, y: 10 })], context, first.state);
    expect(second).toEqual({ state: first.state, intents: [] });
  });

  it('ignores moves and releases with no press', () => {
    const idle = [pointer('pointerMove', { x: 1, y: 1 }), pointer('pointerUp', { x: 1, y: 1 })];
    expect(run(idle, contextFor())).toEqual({ state: IDLE_SELECT_TOOL, intents: [] });
  });
});

describe('select tool: moving', () => {
  it('drags the selection by the pointer’s displacement from the press, then commits', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const { state, intents } = run(
      [
        pointer('pointerDown', { x: 10, y: 10 }),
        pointer('pointerMove', { x: 20, y: 15 }),
        pointer('pointerMove', { x: 40, y: 30 }),
        pointer('pointerUp', { x: 45, y: 30 }),
      ],
      context,
    );
    expect(intents).toEqual([
      { type: 'move', delta: { x: 10, y: 5 }, isAxisLocked: false },
      { type: 'move', delta: { x: 30, y: 20 }, isAxisLocked: false },
      { type: 'move', delta: { x: 35, y: 20 }, isAxisLocked: false },
      { type: 'commit' },
    ]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('locks a Shift drag to its larger axis', () => {
    const { intents } = run(
      [
        pointer('pointerDown', { x: 10, y: 10 }),
        pointer('pointerMove', { x: 40, y: 22 }, true),
        pointer('pointerMove', { x: 20, y: 60 }, true),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([
      { type: 'move', delta: { x: 30, y: 0 }, isAxisLocked: true },
      { type: 'move', delta: { x: 0, y: 50 }, isAxisLocked: true },
    ]);
  });

  it('measures the click threshold in screen pixels, whatever the zoom', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { zoom: 4 });
    const at = (kind: 'pointerDown' | 'pointerMove', screenX: number): SelectInput => ({
      kind,
      screen: { x: screenX, y: 80 },
      world: { x: screenX / 4, y: 20 },
      isShiftPressed: false,
      isModPressed: false,
    });
    expect(run([at('pointerDown', 80), at('pointerMove', 83)], context).intents).toEqual([]);
    expect(run([at('pointerDown', 80), at('pointerMove', 88)], context).intents).toEqual([
      { type: 'move', delta: { x: 2, y: 0 }, isAxisLocked: false },
    ]);
  });

  it('moves the whole selection from empty space inside a multi-selection’s frame; a click there clears it', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const drag = run(
      [pointer('pointerDown', { x: 150, y: 25 }), pointer('pointerMove', { x: 160, y: 25 })],
      context,
    );
    expect(drag.intents).toEqual([{ type: 'move', delta: { x: 10, y: 0 }, isAxisLocked: false }]);
    const click = run(
      [pointer('pointerDown', { x: 150, y: 25 }), pointer('pointerUp', { x: 150, y: 25 })],
      context,
    );
    expect(click.intents).toEqual([{ type: 'select', ids: [] }]);
  });
});

describe('select tool: marquee', () => {
  it('intersects dragging right and contains dragging left, replacing the selection', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const right = run(
      [pointer('pointerDown', { x: 150, y: 100 }), pointer('pointerMove', { x: 250, y: 60 })],
      context,
    );
    expect(right.intents).toEqual([
      {
        type: 'marquee',
        rect: { minX: 150, minY: 60, maxX: 250, maxY: 100 },
        mode: 'intersect',
        ids: [B, C],
      },
    ]);
    const left = run(
      [pointer('pointerDown', { x: 150, y: 100 }), pointer('pointerMove', { x: 120, y: 160 })],
      context,
    );
    expect(left.intents).toEqual([
      {
        type: 'marquee',
        rect: { minX: 120, minY: 100, maxX: 150, maxY: 160 },
        mode: 'contain',
        ids: [C],
      },
    ]);
  });

  it('adds to the selection with Shift, and commits on release', () => {
    const { intents } = run(
      [
        pointer('pointerDown', { x: 150, y: 100 }, true),
        pointer('pointerMove', { x: 120, y: 160 }, true),
        pointer('pointerUp', { x: 120, y: 160 }, true),
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.map((intent) => ('ids' in intent ? intent.ids : intent.type))).toEqual([
      [A, C],
      [A, C],
      'commit',
    ]);
  });

  it('restores the selection from before the press when Escape cancels it', () => {
    const { state, intents } = run(
      [
        pointer('pointerDown', { x: 150, y: 100 }),
        pointer('pointerMove', { x: 250, y: 60 }),
        { kind: 'escape' },
      ],
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents.slice(1)).toEqual([{ type: 'select', ids: [A] }, { type: 'cancel' }]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });
});

describe('select tool: Escape, lost pointers and nudges', () => {
  it('cancels a drag on Escape or a lost pointer, and returns to idle', () => {
    const drag = [
      pointer('pointerDown', { x: 10, y: 10 }),
      pointer('pointerMove', { x: 30, y: 10 }),
    ];
    const context = contextFor(selectionOf([A]), FRAME_A);
    for (const lost of [{ kind: 'escape' }, { kind: 'pointerCancel' }] as const) {
      const { state, intents } = run([...drag, lost], context);
      expect(intents.at(-1)).toEqual({ type: 'cancel' });
      expect(state).toBe(IDLE_SELECT_TOOL);
    }
  });

  it('forgets a press on Escape, and clears the selection on Escape when idle', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    const pressed = run([pointer('pointerDown', { x: 10, y: 10 }), { kind: 'escape' }], context);
    expect(pressed).toEqual({ state: IDLE_SELECT_TOOL, intents: [] });
    expect(run([{ kind: 'escape' }], context).intents).toEqual([{ type: 'select', ids: [] }]);
    expect(run([{ kind: 'escape' }], contextFor()).intents).toEqual([]);
    expect(run([{ kind: 'pointerCancel' }], context).intents).toEqual([]);
  });

  it('nudges the selection one world unit, ten with Shift, and only when something is selected', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    expect(run([{ kind: 'nudge', direction: 'left', isLarge: false }], context).intents).toEqual([
      { type: 'nudge', delta: { x: -NUDGE_DISTANCE, y: 0 } },
    ]);
    expect(run([{ kind: 'nudge', direction: 'down', isLarge: true }], context).intents).toEqual([
      { type: 'nudge', delta: { x: 0, y: NUDGE_LARGE_DISTANCE } },
    ]);
    expect(NUDGE_LARGE_DISTANCE).toBe(10 * NUDGE_DISTANCE);
    expect(run([{ kind: 'nudge', direction: 'up', isLarge: false }], contextFor()).intents).toEqual(
      [],
    );
    const dragging = run(
      [pointer('pointerDown', { x: 10, y: 10 }), pointer('pointerMove', { x: 30, y: 10 })],
      context,
    ).state;
    expect(
      run([{ kind: 'nudge', direction: 'up', isLarge: false }], context, dragging).intents,
    ).toEqual([]);
  });
});
