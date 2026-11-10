import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import {
  cameraOperationFor,
  FIT_PADDING_PX,
  KEYBOARD_PAN_LARGE_PX,
  KEYBOARD_PAN_PX,
  type CameraInputContext,
} from './camera-input.js';
import { steppedZoom } from './zoom-levels.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 3, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const EMPTY: CameraInputContext = {
  camera: CAMERA,
  contentBounds: undefined,
  selectionBounds: undefined,
};
const CONTENT = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('cameraOperationFor: the wheel', () => {
  it('zooms about the cursor with Control or ⌘ held, by exp(−deltaY / 100)', () => {
    const operation = cameraOperationFor(
      {
        kind: 'wheel',
        point: { x: 30, y: 40 },
        deltaXPx: 0,
        deltaYPx: -100 * Math.log(2),
        isZoomModifierPressed: true,
      },
      EMPTY,
    );
    expect(operation).toMatchObject({ type: 'zoomAt', point: { x: 30, y: 40 } });
    expect(operation?.type === 'zoomAt' ? operation.factor : Number.NaN).toBeCloseTo(2, 12);
  });

  it('pans without a modifier, the board moving against the scroll', () => {
    expect(
      cameraOperationFor(
        {
          kind: 'wheel',
          point: { x: 0, y: 0 },
          deltaXPx: 12,
          deltaYPx: 30,
          isZoomModifierPressed: false,
        },
        EMPTY,
      ),
    ).toEqual({ type: 'panBy', deltaXPx: -12, deltaYPx: -30 });
  });
});

describe('cameraOperationFor: gestures', () => {
  it('turns a pinch into a zoom about its midpoint', () => {
    expect(
      cameraOperationFor({ kind: 'pinch', center: { x: 5, y: 6 }, scale: 1.5 }, EMPTY),
    ).toEqual({ type: 'zoomAt', point: { x: 5, y: 6 }, factor: 1.5 });
  });

  it('turns a two-finger or middle-button drag into a pan by the same delta', () => {
    expect(cameraOperationFor({ kind: 'drag', deltaXPx: 3, deltaYPx: -4 }, EMPTY)).toEqual({
      type: 'panBy',
      deltaXPx: 3,
      deltaYPx: -4,
    });
  });
});

describe('cameraOperationFor: the keyboard', () => {
  it('pans the view the way an arrow points, so the board moves the other way', () => {
    const pan = (direction: 'up' | 'down' | 'left' | 'right', isLarge = false) =>
      cameraOperationFor({ kind: 'keyPan', direction, isLarge }, EMPTY);
    expect(pan('right')).toEqual({ type: 'panBy', deltaXPx: -KEYBOARD_PAN_PX, deltaYPx: 0 });
    expect(pan('left')).toEqual({ type: 'panBy', deltaXPx: KEYBOARD_PAN_PX, deltaYPx: 0 });
    expect(pan('down')).toEqual({ type: 'panBy', deltaXPx: 0, deltaYPx: -KEYBOARD_PAN_PX });
    expect(pan('up', true)).toEqual({
      type: 'panBy',
      deltaXPx: 0,
      deltaYPx: KEYBOARD_PAN_LARGE_PX,
    });
  });

  it('zooms in and out to the next level of the zoom ladder about the viewport centre', () => {
    expect(cameraOperationFor({ kind: 'keyZoom', command: 'zoomIn' }, EMPTY)).toEqual({
      type: 'zoomTo',
      zoom: steppedZoom(3, 'in'),
    });
    expect(cameraOperationFor({ kind: 'keyZoom', command: 'zoomOut' }, EMPTY)).toEqual({
      type: 'zoomTo',
      zoom: steppedZoom(3, 'out'),
    });
    expect(steppedZoom(3, 'in')).toBe(4);
    expect(steppedZoom(3, 'out')).toBe(2.5);
    expect(cameraOperationFor({ kind: 'keyZoom', command: 'zoomToActualSize' }, EMPTY)).toEqual({
      type: 'zoomTo',
      zoom: 1,
    });
  });

  it('fits the content, or returns to the origin on an empty board', () => {
    expect(
      cameraOperationFor(
        { kind: 'keyZoom', command: 'zoomToFit' },
        { ...EMPTY, contentBounds: CONTENT },
      ),
    ).toEqual({ type: 'fitToRect', bounds: CONTENT, paddingPx: FIT_PADDING_PX });
    expect(cameraOperationFor({ kind: 'keyZoom', command: 'zoomToFit' }, EMPTY)).toEqual({
      type: 'resetToOrigin',
    });
  });

  it('frames a rectangle it is given (a comment cluster)', () => {
    expect(cameraOperationFor({ kind: 'frame', bounds: CONTENT }, EMPTY)).toEqual({
      type: 'fitToRect',
      bounds: CONTENT,
      paddingPx: FIT_PADDING_PX,
    });
  });

  it('fits the selection when there is one', () => {
    expect(
      cameraOperationFor(
        { kind: 'keyZoom', command: 'zoomToSelection' },
        { ...EMPTY, contentBounds: CONTENT, selectionBounds: CONTENT },
      ),
    ).toEqual({ type: 'fitToSelection', bounds: CONTENT, paddingPx: FIT_PADDING_PX });
    expect(cameraOperationFor({ kind: 'keyZoom', command: 'zoomToSelection' }, EMPTY)).toEqual({
      type: 'fitToSelection',
      bounds: undefined,
      paddingPx: FIT_PADDING_PX,
    });
  });
});
