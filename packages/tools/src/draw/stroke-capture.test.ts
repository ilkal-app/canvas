import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import type { SelectPointer, SelectPointerType } from '../select/select-input.js';

import { StrokeCapture } from './stroke-capture.js';

/**
 * A pointer at a world point.
 *
 * @param world - The point.
 * @param extra - Its pointer type, pressure and trail.
 * @returns The pointer.
 */
function at(
  world: Point,
  extra: Partial<Pick<SelectPointer, 'pressure' | 'trail'>> & {
    readonly pointerType?: SelectPointerType;
  } = {},
): SelectPointer {
  return { screen: world, world, isShiftPressed: false, isModPressed: false, ...extra };
}

describe('StrokeCapture', () => {
  it('records the press, a move’s raw samples (not its aggregate point), and the release', () => {
    const capture = new StrokeCapture();
    expect(capture.press(at({ x: 0, y: 0 }))).toBe(true);
    expect(capture.isCapturing).toBe(true);
    // The aggregate (10, 0) differs from the last raw sample (9, 1): the raw one is kept.
    const trail = [{ world: { x: 4, y: 1 } }, { world: { x: 9, y: 1 } }];
    capture.extend(at({ x: 10, y: 0 }, { trail }), 1);
    capture.extend(at({ x: 11, y: 2 }), 1);
    const samples = capture.release(at({ x: 13, y: 3 }), 1);
    expect(samples).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      { x: 9, y: 1 },
      { x: 11, y: 2 },
      { x: 13, y: 3 },
    ]);
    expect(capture.isCapturing).toBe(false);
    expect(capture.samples).toEqual([]);
  });

  it('drops samples closer than half a screen pixel to the one kept before, at the zoom', () => {
    const capture = new StrokeCapture();
    capture.press(at({ x: 0, y: 0 }));
    // At zoom 4, 0.1 world units is 0.4 px: dropped; 0.2 is 0.8 px: kept.
    expect(capture.extend(at({ x: 0.1, y: 0 }), 4)).toBe(false);
    expect(capture.extend(at({ x: 0.2, y: 0 }), 4)).toBe(true);
    expect(capture.release(at({ x: 0.2, y: 0 }), 4)).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
    ]);
  });

  it('keeps each sample’s pressure, and gives the release the last one (a pen lifts at 0)', () => {
    const capture = new StrokeCapture();
    const pen = { pointerType: 'pen' } as const;
    capture.press(at({ x: 0, y: 0 }, { ...pen, pressure: 0.2 }));
    capture.extend(
      at(
        { x: 10, y: 0 },
        {
          ...pen,
          pressure: 0.5,
          trail: [
            { world: { x: 5, y: 0 }, pressure: 0.4 },
            { world: { x: 10, y: 0 }, pressure: 0.6 },
          ],
        },
      ),
      1,
    );
    expect(capture.release(at({ x: 20, y: 0 }, { ...pen, pressure: 0 }), 1)).toEqual([
      { x: 0, y: 0, pressure: 0.2 },
      { x: 5, y: 0, pressure: 0.4 },
      { x: 10, y: 0, pressure: 0.6 },
      { x: 20, y: 0, pressure: 0.6 },
    ]);
  });

  it('makes a one-sample stroke of a press and release without movement', () => {
    const capture = new StrokeCapture();
    capture.press(at({ x: 3, y: 4 }));
    expect(capture.release(at({ x: 3, y: 4 }), 1)).toEqual([{ x: 3, y: 4 }]);
  });

  it('ignores moves and releases with no stroke under way, and drops one on cancel', () => {
    const capture = new StrokeCapture();
    expect(capture.extend(at({ x: 1, y: 1 }), 1)).toBe(false);
    expect(capture.release(at({ x: 1, y: 1 }), 1)).toBeUndefined();
    capture.press(at({ x: 0, y: 0 }));
    capture.cancel();
    expect(capture.release(at({ x: 9, y: 9 }), 1)).toBeUndefined();
  });

  it('rejects a finger’s press once a pen was seen pressing or hovering (palm rejection)', () => {
    const pressed = new StrokeCapture();
    expect(pressed.press(at({ x: 0, y: 0 }, { pointerType: 'touch' }))).toBe(true);
    pressed.release(at({ x: 0, y: 0 }), 1);
    expect(pressed.press(at({ x: 0, y: 0 }, { pointerType: 'pen' }))).toBe(true);
    pressed.release(at({ x: 0, y: 0 }), 1);
    expect(pressed.press(at({ x: 0, y: 0 }, { pointerType: 'touch' }))).toBe(false);
    expect(pressed.isCapturing).toBe(false);
    expect(pressed.press(at({ x: 0, y: 0 }, { pointerType: 'mouse' }))).toBe(true);

    const hovered = new StrokeCapture();
    hovered.note({ pointerType: 'pen' });
    expect(hovered.press(at({ x: 0, y: 0 }, { pointerType: 'touch' }))).toBe(false);
  });
});
