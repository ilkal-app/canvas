import { describe, expect, it } from 'vitest';

import {
  A,
  B,
  contextFor,
  DEGREE,
  FRAME_A,
  FRAME_AB,
  pointer,
  run,
} from './__fixtures__/select-tool-steps.js';
import { rotatePointAbout, type OrientedBox } from './oriented-box.js';
import { selectionOf } from './selection-state.js';

// The handle drags of the select tool's state machine (select-drag.ts), driven through
// stepSelectTool; clicks, moves, marquees and keys are in select-tool.test.ts.
describe('select tool: handles', () => {
  it('prefers a handle over the object under it', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const { intents } = run(
      [pointer('pointerDown', { x: 100, y: 50 }), pointer('pointerMove', { x: 120, y: 60 })],
      context,
    );
    expect(intents).toEqual([
      {
        type: 'resize',
        handle: 'se',
        delta: { x: 20, y: 10 },
        isProportional: false,
        from: FRAME_A,
        to: { ...FRAME_A, width: 120, height: 60 },
      },
    ]);
  });

  it('resizes proportionally from a corner with Shift', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    const { intents } = run(
      [
        pointer('pointerDown', { x: 100, y: 50 }),
        pointer('pointerMove', { x: 150, y: 55 }, true),
        pointer('pointerUp', { x: 150, y: 55 }, true),
      ],
      context,
    );
    expect(intents[1]).toMatchObject({
      type: 'resize',
      isProportional: true,
      to: { x: 0, y: 0, width: 150, height: 75, rotation: 0 },
    });
    expect(intents[2]).toEqual({ type: 'commit' });
  });

  it('resizes a rotated single object along its own axes', () => {
    // Object a turned a quarter turn clockwise about its corner at (100, 0).
    const turned: OrientedBox = { x: 100, y: 0, width: 100, height: 50, rotation: Math.PI / 2 };
    // Local (100, 25), the "e" handle, is world (100 − 25, 100) = (75, 100).
    const context = contextFor(selectionOf([A]), turned);
    const { intents } = run(
      [pointer('pointerDown', { x: 75, y: 100 }), pointer('pointerMove', { x: 75, y: 130 })],
      context,
    );
    expect(intents[0]).toMatchObject({ type: 'resize', handle: 'e' });
    const to = intents[0]?.type === 'resize' ? intents[0].to : undefined;
    expect(to?.width).toBeCloseTo(130, 9);
    expect(to?.height).toBeCloseTo(50, 9);
    expect(to?.x).toBeCloseTo(100, 9);
  });

  it('rotates about the frame’s centre from a corner band, snapping to 15° with Shift', () => {
    const context = contextFor(selectionOf([A]), FRAME_A);
    // In the band outside the top-left corner; the drag turns it 22° clockwise about the
    // centre (50, 25).
    const band = { x: -8, y: -8 };
    const to = rotatePointAbout(band, { x: 50, y: 25 }, 22 * DEGREE);
    const free = run([pointer('pointerDown', band), pointer('pointerMove', to)], context);
    expect(free.intents[0]).toMatchObject({
      type: 'rotate',
      isSnapped: false,
      pivot: { x: 50, y: 25 },
    });
    const freeAngle = free.intents[0]?.type === 'rotate' ? free.intents[0].angle : Number.NaN;
    expect(freeAngle).toBeCloseTo(22 * DEGREE, 9);
    const snapped = run([pointer('pointerDown', band), pointer('pointerMove', to, true)], context);
    const snappedAngle =
      snapped.intents[0]?.type === 'rotate' ? snapped.intents[0].angle : Number.NaN;
    expect(snappedAngle).toBeCloseTo(15 * DEGREE, 9);
  });

  it('offers no resize handles when the selection cannot be resized', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { canResize: false });
    const { intents } = run(
      [pointer('pointerDown', { x: 100, y: 50 }), pointer('pointerMove', { x: 120, y: 60 })],
      context,
    );
    expect(intents).toEqual([{ type: 'move', delta: { x: 20, y: 10 }, isAxisLocked: false }]);
  });

  it('still rotates from a corner band when the selection cannot be resized', () => {
    const context = contextFor(selectionOf([A]), FRAME_A, { canResize: false });
    const band = { x: 108, y: 58 };
    const to = rotatePointAbout(band, { x: 50, y: 25 }, -30 * DEGREE);
    const { intents } = run([pointer('pointerDown', band), pointer('pointerMove', to)], context);
    expect(intents[0]).toMatchObject({ type: 'rotate', pivot: { x: 50, y: 25 }, from: FRAME_A });
    const angle = intents[0]?.type === 'rotate' ? intents[0].angle : Number.NaN;
    expect(angle).toBeCloseTo(-30 * DEGREE, 9);
  });

  it('rotates a multi-selection about its frame’s centre and ends in one commit', () => {
    const context = contextFor(selectionOf([A, B]), FRAME_AB);
    // The band outside the frame's top-right corner (300, 0); the pivot is (150, 25).
    const band = { x: 308, y: -8 };
    const to = rotatePointAbout(band, { x: 150, y: 25 }, 91 * DEGREE);
    const { intents } = run(
      [
        pointer('pointerDown', band),
        pointer('pointerMove', to, true),
        pointer('pointerUp', to, true),
      ],
      context,
    );
    expect(intents).toHaveLength(3);
    expect(intents[1]).toMatchObject({ type: 'rotate', isSnapped: true, pivot: { x: 150, y: 25 } });
    const angle = intents[1]?.type === 'rotate' ? intents[1].angle : Number.NaN;
    expect(angle).toBeCloseTo(90 * DEGREE, 9);
    expect(intents[2]).toEqual({ type: 'commit' });
  });
});
