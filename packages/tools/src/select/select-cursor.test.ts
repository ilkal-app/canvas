import { describe, expect, it } from 'vitest';

import { A, contextFor, DEGREE, FRAME_A, pointer, run } from './__fixtures__/select-tool-steps.js';
import { rotatePointAbout, type OrientedBox } from './oriented-box.js';
import {
  hoverCursorAt,
  ROTATE_CURSOR_STEPS,
  rotateCursorStepOf,
  type SelectCursor,
} from './select-cursor.js';
import { IDLE_SELECT_TOOL, restingSelectTool } from './select-tool.js';
import { selectionOf } from './selection-state.js';

const SELECTED_A = contextFor(selectionOf([A]), FRAME_A);

/** A 4:1 box at the origin, 200 × 50, its centre at (100, 25). */
const WIDE: OrientedBox = { x: 0, y: 0, width: 200, height: 50, rotation: 0 };

/** The 4:1 box's centre. */
const WIDE_CENTRE = { x: 100, y: 25 };

/** The 4:1 box turned 45° clockwise about its centre. */
const WIDE_TURNED: OrientedBox = {
  ...rotatePointAbout(WIDE, WIDE_CENTRE, 45 * DEGREE),
  width: 200,
  height: 50,
  rotation: 45 * DEGREE,
};

/** Points 10 world units out of each corner of the unturned 4:1 box, nw ne se sw. */
const WIDE_BANDS = [
  { x: -7, y: -7 },
  { x: 207, y: -7 },
  { x: 207, y: 57 },
  { x: -7, y: 57 },
];

/**
 * The rotate cursor's angle at each corner's band of a 4:1 box.
 *
 * @param frame - The box, unturned or turned about its centre.
 * @returns The angles, radians, nw ne se sw.
 */
function anglesAtCorners(frame: OrientedBox): number[] {
  const context = contextFor(selectionOf([A]), frame);
  return WIDE_BANDS.map((point) =>
    angleOf(hoverCursorAt(rotatePointAbout(point, WIDE_CENTRE, frame.rotation), context)),
  );
}

/**
 * The angle a cursor carries, or fails when it is not the rotate cursor.
 *
 * @param cursor - The cursor.
 * @returns The angle, radians.
 * @throws {Error} When the cursor is the default one.
 */
function angleOf(cursor: SelectCursor): number {
  if (cursor === 'default') throw new Error('Expected the rotate cursor.');
  return cursor.angle;
}

describe('hoverCursorAt', () => {
  it('is the rotate cursor in a corner’s rotation band, the default elsewhere', () => {
    expect(hoverCursorAt({ x: -8, y: -8 }, SELECTED_A)).toMatchObject({ kind: 'rotate' });
    expect(hoverCursorAt({ x: 108, y: 58 }, SELECTED_A)).toMatchObject({ kind: 'rotate' });
    expect(hoverCursorAt({ x: 50, y: 25 }, SELECTED_A)).toBe('default');
    expect(hoverCursorAt({ x: 150, y: 25 }, SELECTED_A)).toBe('default');
  });

  it('keeps the corner handle’s cursor where the handle overlaps the band', () => {
    expect(hoverCursorAt({ x: -5, y: -5 }, SELECTED_A)).toBe('default');
  });

  it('is the default cursor with nothing selected', () => {
    expect(hoverCursorAt({ x: -8, y: -8 }, contextFor())).toBe('default');
  });

  it('turns a quarter turn per corner, clockwise from the top-left, whatever the box’s shape', () => {
    expect(anglesAtCorners(WIDE)).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
    // Anywhere in the band: the angle is the corner's, not the pointer's direction.
    expect(hoverCursorAt({ x: 0, y: -17 }, contextFor(selectionOf([A]), WIDE))).toEqual({
      kind: 'rotate',
      angle: 0,
    });
  });

  it('turns every corner by the frame’s rotation', () => {
    const angles = anglesAtCorners(WIDE_TURNED);
    for (const [corner, angle] of angles.entries()) {
      expect(angle).toBeCloseTo((corner * Math.PI) / 2 + 45 * DEGREE, 12);
    }
  });

  it('gives the four corners orientations a quarter turn apart', () => {
    const quarter = ROTATE_CURSOR_STEPS / 4;
    for (const frame of [WIDE, WIDE_TURNED]) {
      const steps = anglesAtCorners(frame).map(rotateCursorStepOf);
      for (const [corner, step] of steps.entries()) {
        const next = steps[(corner + 1) % 4] ?? Number.NaN;
        expect((next - step + ROTATE_CURSOR_STEPS) % ROTATE_CURSOR_STEPS).toBe(quarter);
      }
    }
    expect(anglesAtCorners(WIDE_TURNED).map(rotateCursorStepOf)).toEqual([3, 9, 15, 21]);
  });

  it('keeps the previous cursor object while the orientation stays in the same step', () => {
    const context = contextFor(selectionOf([A]), WIDE);
    const first = hoverCursorAt({ x: -7, y: -7 }, context);
    expect(hoverCursorAt({ x: 0, y: -17 }, context, first)).toBe(first);
    const turned = hoverCursorAt({ x: 207, y: -7 }, context, first);
    expect(turned).not.toBe(first);
    expect(rotateCursorStepOf(angleOf(turned))).toBe(6);
  });
});

describe('rotateCursorStepOf', () => {
  it('quantises an angle to the nearest 15°, clockwise from the untouched icon', () => {
    expect(ROTATE_CURSOR_STEPS).toBe(24);
    expect(rotateCursorStepOf(0)).toBe(0);
    expect(rotateCursorStepOf(7 * DEGREE)).toBe(0);
    expect(rotateCursorStepOf(8 * DEGREE)).toBe(1);
    expect(rotateCursorStepOf(90 * DEGREE)).toBe(6);
    expect(rotateCursorStepOf(Math.PI)).toBe(12);
    expect(rotateCursorStepOf(-Math.PI)).toBe(12);
    expect(rotateCursorStepOf(-135 * DEGREE)).toBe(15);
    expect(rotateCursorStepOf(-7 * DEGREE)).toBe(0);
    expect(rotateCursorStepOf(-8 * DEGREE)).toBe(23);
    expect(rotateCursorStepOf(2 * Math.PI + 90 * DEGREE)).toBe(6);
  });
});

describe('select tool: cursor', () => {
  it('starts with the default cursor', () => {
    expect(IDLE_SELECT_TOOL.cursor).toBe('default');
  });

  it('turns to the rotate cursor while hovering a band, and back when leaving it', () => {
    const inBand = run([pointer('pointerMove', { x: -8, y: -8 })], SELECTED_A);
    expect(inBand).toEqual({
      state: { phase: 'idle', cursor: { kind: 'rotate', angle: 0 }, enteredGroupId: null },
      intents: [],
    });
    const left = run([pointer('pointerMove', { x: 50, y: 25 })], SELECTED_A, inBand.state);
    expect(left.state).toBe(IDLE_SELECT_TOOL);
  });

  it('keeps the same state while a hover stays in one orientation step', () => {
    const inBand = run([pointer('pointerMove', { x: -8, y: -8 })], SELECTED_A);
    const still = run([pointer('pointerMove', { x: -8, y: -9 })], SELECTED_A, inBand.state);
    expect(still.state).toBe(inBand.state);
    expect(restingSelectTool({ x: -9, y: -8 }, SELECTED_A, inBand.state)).toBe(inBand.state);
  });

  it('keeps the rotate cursor through a rotation drag, turning it with the selection', () => {
    const pressed = run([pointer('pointerDown', { x: -8, y: -8 })], SELECTED_A);
    expect(pressed.state.cursor).toEqual({ kind: 'rotate', angle: 0 });
    // The press is at about −150.4° from the pivot (50, 25); the top-left corner's cursor turns
    // by the angle swept from there.
    const pressBearing = Math.atan2(-33, -58);
    const dragged = run([pointer('pointerMove', { x: 50, y: -40 })], SELECTED_A, pressed.state);
    expect(dragged.state).toMatchObject({ phase: 'dragging', cursor: { kind: 'rotate' } });
    expect(angleOf(dragged.state.cursor)).toBeCloseTo(-90 * DEGREE - pressBearing, 12);
    const swept = run([pointer('pointerMove', { x: 150, y: 25 })], SELECTED_A, dragged.state);
    expect(angleOf(swept.state.cursor)).toBeCloseTo(-pressBearing, 12);
    const nudged = run([pointer('pointerMove', { x: 150, y: 26 })], SELECTED_A, swept.state);
    expect(nudged.state).toBe(swept.state);
  });

  it('turns the cursor of the corner a rotation drag started from', () => {
    const pressed = run([pointer('pointerDown', { x: -8, y: 58 })], SELECTED_A);
    expect(pressed.state.cursor).toEqual({ kind: 'rotate', angle: (3 * Math.PI) / 2 });
    // Straight below the pivot (50, 25) from about 150.4°: −60.4° swept.
    const dragged = run([pointer('pointerMove', { x: 50, y: 90 })], SELECTED_A, pressed.state);
    expect(angleOf(dragged.state.cursor)).toBeCloseTo(
      (3 * Math.PI) / 2 + 90 * DEGREE - Math.atan2(33, -58),
      12,
    );
  });

  it('shows the default cursor for a move, a resize and a marquee', () => {
    for (const start of [
      { x: 50, y: 25 },
      { x: 100, y: 50 },
      { x: 150, y: 25 },
    ]) {
      const { state } = run(
        [pointer('pointerDown', start), pointer('pointerMove', { x: 170, y: 40 })],
        SELECTED_A,
      );
      expect(state).toMatchObject({ phase: 'dragging', cursor: 'default' });
    }
  });

  it('after a release, shows the cursor for where the pointer rests', () => {
    const inBand = run(
      [pointer('pointerDown', { x: -8, y: -8 }), pointer('pointerUp', { x: -8, y: -8 })],
      SELECTED_A,
    );
    expect(inBand.state).toMatchObject({ phase: 'idle', cursor: { kind: 'rotate' } });
    const moved = run(
      [
        pointer('pointerDown', { x: -8, y: -8 }),
        pointer('pointerMove', { x: 50, y: -40 }),
        pointer('pointerUp', { x: 50, y: -40 }),
      ],
      SELECTED_A,
    );
    expect(moved.state).toBe(IDLE_SELECT_TOOL);
  });

  it('returns to the default cursor when Escape cancels a rotation drag', () => {
    const { state } = run(
      [pointer('pointerDown', { x: -8, y: -8 }), pointer('pointerMove', { x: 50, y: -40 })],
      SELECTED_A,
    );
    expect(run([{ kind: 'escape' }], SELECTED_A, state).state).toBe(IDLE_SELECT_TOOL);
  });
});
