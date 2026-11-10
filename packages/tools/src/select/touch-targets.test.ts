import { describe, expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import { contextFor } from './__fixtures__/select-tool-steps.js';
import {
  HANDLE_HIT_SIZE_PX,
  handleHitSizePx,
  hitHandle,
  TOUCH_HANDLE_HIT_SIZE_PX,
  TOUCH_HANDLE_INWARD_REACH_PX,
  touchCornerOutwardReachPx,
  touchInwardReachPx,
} from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';
import {
  hitRotationBand,
  ROTATION_BAND_WIDTH_PX,
  rotationBandWidthPx,
  TOUCH_ROTATION_BAND_WIDTH_PX,
} from './rotation-band.js';
import type { SelectHitTester } from './select-hit-tester.js';
import { frameControlAt, resolvePress } from './select-press.js';
import { selectionOf } from './selection-state.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
const SE: Point = { x: 300, y: 200 };

/**
 * A point straight out from the frame's bottom-right corner along its diagonal.
 *
 * @param distance - How far out, world units.
 * @returns The point.
 */
function outFromSe(distance: number): Point {
  const step = distance / Math.SQRT2;
  return { x: SE.x + step, y: SE.y + step };
}

describe('touch targets', () => {
  it('sizes a finger’s handles at 44 CSS px and leaves the mouse’s and pen’s as they were', () => {
    expect(TOUCH_HANDLE_HIT_SIZE_PX).toBe(44);
    expect(handleHitSizePx('touch')).toBe(44);
    expect(handleHitSizePx('mouse')).toBe(HANDLE_HIT_SIZE_PX);
    expect(handleHitSizePx('pen')).toBe(HANDLE_HIT_SIZE_PX);
    expect(handleHitSizePx()).toBe(HANDLE_HIT_SIZE_PX);
  });

  it('reaches a finger’s squares 6 px into the frame, or a sixth of a small side', () => {
    expect(TOUCH_HANDLE_INWARD_REACH_PX).toBe(6);
    expect(touchInwardReachPx(200)).toBe(6);
    expect(touchInwardReachPx(36)).toBe(6);
    expect(touchInwardReachPx(30)).toBe(5);
    expect(touchInwardReachPx(0)).toBe(0);
    expect(touchCornerOutwardReachPx(FRAME, 1)).toBe(38);
    expect(touchCornerOutwardReachPx({ ...FRAME, width: 30, height: 20 }, 1)).toBe(39);
  });

  it('biases a finger’s corner square out of the frame: 6 px in, 38 px out', () => {
    expect(hitHandle(FRAME, 1, { x: SE.x - 6, y: SE.y - 6 }, true, 'touch')).toBe('se');
    expect(hitHandle(FRAME, 1, { x: SE.x - 6.5, y: SE.y - 6 }, true, 'touch')).toBeUndefined();
    expect(hitHandle(FRAME, 1, { x: SE.x + 38, y: SE.y + 38 }, true, 'touch')).toBe('se');
    expect(hitHandle(FRAME, 1, { x: SE.x + 38.5, y: SE.y }, true, 'touch')).toBeUndefined();
  });

  it('biases a finger’s edge square the same way, centred along its edge', () => {
    const east = { x: SE.x, y: 150 };
    expect(hitHandle(FRAME, 1, { x: east.x + 38, y: east.y + 22 }, true, 'touch')).toBe('e');
    expect(hitHandle(FRAME, 1, { x: east.x - 6, y: east.y - 22 }, true, 'touch')).toBe('e');
    expect(hitHandle(FRAME, 1, { x: east.x - 7, y: east.y }, true, 'touch')).toBeUndefined();
    expect(hitHandle(FRAME, 1, { x: east.x, y: east.y + 23 }, true, 'touch')).toBeUndefined();
  });

  it('keeps a finger’s squares their screen size at every zoom', () => {
    expect(hitHandle(FRAME, 4, { x: SE.x - 6 / 4, y: SE.y }, true, 'touch')).toBe('se');
    expect(hitHandle(FRAME, 4, { x: SE.x - 7 / 4, y: SE.y }, true, 'touch')).toBeUndefined();
    expect(hitHandle(FRAME, 4, { x: SE.x + 38 / 4, y: SE.y }, true, 'touch')).toBe('se');
    expect(hitHandle(FRAME, 4, { x: SE.x + 39 / 4, y: SE.y }, true, 'touch')).toBeUndefined();
  });

  it('leaves the mouse’s and pen’s squares centred on their handles', () => {
    for (const pointerType of ['mouse', 'pen'] as const) {
      expect(hitHandle(FRAME, 1, { x: SE.x - 6, y: SE.y + 6 }, true, pointerType)).toBe('se');
      expect(hitHandle(FRAME, 1, { x: SE.x + 6.5, y: SE.y }, true, pointerType)).toBeUndefined();
      expect(hitHandle(FRAME, 1, { x: SE.x - 6.5, y: SE.y }, true, pointerType)).toBeUndefined();
    }
  });

  it('runs a finger’s rotation band from where its corner square ends, 24 px wide', () => {
    expect(TOUCH_ROTATION_BAND_WIDTH_PX).toBe(24);
    expect(rotationBandWidthPx('touch')).toBe(24);
    expect(rotationBandWidthPx('mouse')).toBe(ROTATION_BAND_WIDTH_PX);
    expect(hitRotationBand(FRAME, 1, outFromSe(37.5), 'touch')).toBeUndefined();
    expect(hitRotationBand(FRAME, 1, outFromSe(38.5), 'touch')).toBe('se');
    expect(hitRotationBand(FRAME, 1, outFromSe(61.5), 'touch')).toBe('se');
    expect(hitRotationBand(FRAME, 1, outFromSe(62.5), 'touch')).toBeUndefined();
    // The mouse's band is where it was: 6 to 18 px out.
    expect(hitRotationBand(FRAME, 1, outFromSe(6.5), 'mouse')).toBe('se');
    expect(hitRotationBand(FRAME, 1, outFromSe(18.5), 'mouse')).toBeUndefined();
  });

  it('resolves a finger on the corner to the handle first, then the band beyond it', () => {
    const context = {
      frame: FRAME,
      zoom: 1,
      canResize: true,
      isLocked: false,
      selection: selectionOf(['a' as ObjectId]),
    };
    expect(frameControlAt(outFromSe(40), context, 'touch')).toMatchObject({ handle: 'se' });
    expect(frameControlAt(outFromSe(55), context, 'touch')).toMatchObject({ corner: 'se' });
    expect(frameControlAt(outFromSe(40), context, 'mouse')).toBeUndefined();
  });
});

describe('touch targets on a small object', () => {
  const small = 'small' as ObjectId;
  // A 30 × 30 object at (100, 100)–(130, 130), selected, at 100%: 30 × 30 CSS px on screen.
  const frame: OrientedBox = { x: 100, y: 100, width: 30, height: 30, rotation: 0 };
  const hitTester: SelectHitTester = {
    isAboveSelection: () => false,
    hitPoint: ({ x, y }) =>
      x >= 100 && x <= 130 && y >= 100 && y <= 130
        ? { id: small, part: 'object', scope: null }
        : undefined,
    hitRect: () => [],
    frameAt: () => undefined,
  };
  const context = contextFor(selectionOf([small]), frame, { hitTester });
  const fingerAt = (x: number, y: number) =>
    resolvePress(
      {
        screen: { x, y },
        world: { x, y },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
      },
      context,
    ).target.kind;

  it('leaves the centre and the middle two thirds along each axis to the object', () => {
    expect(fingerAt(115, 115)).toBe('object');
    // The middle two thirds: 5 px in from each side, (105, 105) to (125, 125), handles ending at 5.
    for (let x = 105.5; x <= 124.5; x += 1) {
      for (let y = 105.5; y <= 124.5; y += 1) expect(fingerAt(x, y)).toBe('object');
    }
  });

  it('keeps each handle’s 44 px square, reaching 5 px in and 39 px out', () => {
    expect(fingerAt(104.5, 104.5)).toBe('handle');
    expect(fingerAt(115, 104.5)).toBe('handle');
    expect(fingerAt(100 - 39, 100 - 39)).toBe('handle');
    expect(fingerAt(100 - 40, 115)).toBe('empty');
  });

  it('leaves a mouse’s handles as they were: 6 px each way from the corner', () => {
    const mouseAt = (x: number, y: number) =>
      resolvePress(
        { screen: { x, y }, world: { x, y }, isShiftPressed: false, isModPressed: false },
        context,
      ).target.kind;
    expect(mouseAt(106, 106)).toBe('handle');
    expect(mouseAt(107, 107)).toBe('object');
  });
});
