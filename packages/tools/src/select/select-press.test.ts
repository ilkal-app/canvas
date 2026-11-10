import { describe, expect, it } from 'vitest';

import { A, B, contextFor, F, FRAME_A, pointer, run } from './__fixtures__/select-tool-steps.js';
import type { SelectInput } from './select-input.js';
import { resolvePress } from './select-press.js';
import { selectionOf } from './selection-state.js';

/** On frame f's background, clear of its children (fixture `HIT_TESTER`). */
const BACKGROUND = { x: 500, y: 200 };

/** On frame f's title band. */
const TITLE = { x: 500, y: 90 };

/** Frame f's box, the selection frame when it alone is selected. */
const FRAME_F = { x: 400, y: 100, width: 200, height: 200, rotation: 0 };

function press(point: { x: number; y: number }, isShiftPressed = false, isModPressed = false) {
  const input = pointer('pointerDown', point, isShiftPressed, isModPressed);
  if (input.kind !== 'pointerDown') throw new Error('not a press');
  return input;
}

function click(point: { x: number; y: number }, isShiftPressed = false, isModPressed = false) {
  return [
    pointer('pointerDown', point, isShiftPressed, isModPressed),
    pointer('pointerUp', point, isShiftPressed, isModPressed),
  ];
}

describe('resolvePress: frames', () => {
  it('passes a plain press on a frame’s background through, as on empty board', () => {
    expect(resolvePress(press(BACKGROUND), contextFor())).toEqual({
      target: { kind: 'empty', onClick: { type: 'select', ids: [] } },
      intents: [],
    });
    expect(resolvePress(press(BACKGROUND, true), contextFor()).target).toEqual({
      kind: 'empty',
      onClick: undefined,
    });
  });

  it('picks the frame on a press on its title band', () => {
    expect(resolvePress(press(TITLE), contextFor())).toEqual({
      target: { kind: 'object', id: F, onClick: undefined },
      intents: [{ type: 'select', ids: [F] }],
      enteredGroupId: null,
    });
  });

  it('picks the frame on a mod+press on its background; Shift with it adds the frame', () => {
    expect(resolvePress(press(BACKGROUND, false, true), contextFor()).intents).toEqual([
      { type: 'select', ids: [F] },
    ]);
    expect(
      resolvePress(press(BACKGROUND, true, true), contextFor(selectionOf([A]))).intents,
    ).toEqual([{ type: 'toggle', id: F }]);
  });

  it('leaves mod alone on anything but a frame’s background', () => {
    expect(resolvePress(press({ x: 10, y: 10 }, false, true), contextFor()).intents).toEqual([
      { type: 'select', ids: [A] },
    ]);
    expect(resolvePress(press({ x: 150, y: 400 }, false, true), contextFor()).target.kind).toBe(
      'empty',
    );
  });
});

describe('select tool: presses on a frame', () => {
  it('draws a marquee from a frame’s background instead of moving the frame', () => {
    const drag: SelectInput[] = [
      pointer('pointerDown', BACKGROUND),
      pointer('pointerMove', { x: 550, y: 250 }),
    ];
    const { intents } = run(drag, contextFor());
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: 'marquee',
      rect: { minX: 500, minY: 200, maxX: 550, maxY: 250 },
      mode: 'intersect',
    });
  });

  it('clears the selection on a plain click on a frame’s background', () => {
    const { intents } = run(click(BACKGROUND), contextFor(selectionOf([A])));
    expect(intents).toEqual([{ type: 'select', ids: [] }]);
  });

  it('selects the frame on a click on its title or a mod+click on its background', () => {
    expect(run(click(TITLE), contextFor()).intents).toEqual([{ type: 'select', ids: [F] }]);
    expect(run(click(BACKGROUND, false, true), contextFor()).intents).toEqual([
      { type: 'select', ids: [F] },
    ]);
  });

  it('moves the frame on a drag from its title', () => {
    const { intents } = run(
      [pointer('pointerDown', TITLE), pointer('pointerMove', { x: 520, y: 90 })],
      contextFor(),
    );
    expect(intents).toEqual([
      { type: 'select', ids: [F] },
      { type: 'move', delta: { x: 20, y: 0 }, isAxisLocked: false },
    ]);
  });
});

describe('select tool: presses on a selected frame’s background', () => {
  it('moves the selection from the background of a frame that is selected', () => {
    const context = contextFor(selectionOf([F]), FRAME_F);
    expect(resolvePress(press(BACKGROUND), context).intents).toEqual([]);
    const { intents } = run(
      [pointer('pointerDown', BACKGROUND), pointer('pointerMove', { x: 520, y: 210 })],
      context,
    );
    expect(intents).toEqual([{ type: 'move', delta: { x: 20, y: 10 }, isAxisLocked: false }]);
  });

  it('moves the whole selection when the frame is one of several selected', () => {
    const context = contextFor(selectionOf([A, F]), {
      x: 0,
      y: 0,
      width: 600,
      height: 300,
      rotation: 0,
    });
    const { intents } = run(
      [pointer('pointerDown', BACKGROUND), pointer('pointerMove', { x: 520, y: 210 })],
      context,
    );
    expect(intents).toEqual([{ type: 'move', delta: { x: 20, y: 10 }, isAxisLocked: false }]);
  });

  it('still draws a marquee from the background of a frame that is not selected', () => {
    const { intents } = run(
      [pointer('pointerDown', BACKGROUND), pointer('pointerMove', { x: 520, y: 210 })],
      contextFor(selectionOf([A]), { x: 0, y: 0, width: 100, height: 50, rotation: 0 }),
    );
    expect(intents[0]).toMatchObject({ type: 'marquee', mode: 'intersect' });
  });

  it('draws an additive marquee on a Shift-press on a selected frame’s background', () => {
    const { intents } = run(
      [pointer('pointerDown', BACKGROUND, true), pointer('pointerMove', { x: 520, y: 210 }, true)],
      contextFor(selectionOf([F]), FRAME_F),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ type: 'marquee', mode: 'intersect' });
    expect(intents[0] && 'ids' in intents[0] && intents[0].ids).toContain(F);
  });

  it('keeps the selection as it is on a plain click there', () => {
    const context = contextFor(selectionOf([F]), FRAME_F);
    expect(resolvePress(press(BACKGROUND), context).target).toEqual({
      kind: 'selection',
      onClick: undefined,
    });
    expect(run(click(BACKGROUND), context).intents).toEqual([]);
  });
});

describe('resolvePress: rotation bands', () => {
  it('starts a rotation from the band just outside a corner of the selection frame', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    expect(resolvePress(press({ x: -8, y: -8 }), context)).toEqual({
      target: { kind: 'rotation', corner: 'nw', frame: FRAME_A },
      intents: [],
    });
    expect(resolvePress(press({ x: 108, y: 58 }), context).target).toMatchObject({
      kind: 'rotation',
      corner: 'se',
    });
  });

  it('resizes, not rotates, where the corner handle overlaps the band', () => {
    // (−5, −5) is 7 px from the corner, inside the band's inner edge (6 px), but also inside
    // the "nw" handle's 12 px square.
    const target = resolvePress(press({ x: -5, y: -5 }), contextFor(selectionOf([A]), FRAME_A));
    expect(target.target).toEqual({ kind: 'handle', handle: 'nw', frame: FRAME_A });
  });

  it('never rotates from inside the box: a press there lands on what is under it', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    expect(resolvePress(press({ x: 8, y: 8 }), context).target.kind).toBe('object');
  });

  it('takes the band over an object under it', () => {
    // The band outside this frame's bottom-left corner, (208, 40), reaches over object b.
    const frame = { x: 208, y: 0, width: 50, height: 40, rotation: 0 };
    const context = contextFor(selectionOf([A]), frame);
    expect(context.hitTester.hitPoint({ x: 200, y: 48 }, 1)?.id).toBe(B);
    expect(resolvePress(press({ x: 200, y: 48 }), context).target).toMatchObject({
      kind: 'rotation',
      corner: 'sw',
    });
  });

  it('keeps the bands when the selection cannot be resized, with no handle in front', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { canResize: false });
    expect(resolvePress(press({ x: -5, y: -5 }), context).target.kind).toBe('rotation');
    expect(resolvePress(press({ x: -3, y: -3 }), context).target.kind).toBe('empty');
  });

  it('sizes the band on screen: at 200% it sits half as far out in world units', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { zoom: 2 });
    // 5.9 world units along the diagonal is 11.9 px: past the 3-unit handle, inside the band.
    expect(resolvePress(press({ x: -4.2, y: -4.2 }), context).target.kind).toBe('rotation');
    expect(resolvePress(press({ x: -8, y: -8 }), context).target.kind).toBe('empty');
  });

  it('has no handles and no bands on a locked selection', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { isLocked: true });
    expect(resolvePress(press({ x: -5, y: -5 }), context).target.kind).toBe('empty');
    expect(resolvePress(press({ x: 0, y: 0 }), context).target.kind).not.toBe('handle');
  });

  it('has no bands without a selection', () => {
    expect(resolvePress(press({ x: -8, y: -8 }), contextFor()).target.kind).toBe('empty');
  });
});
