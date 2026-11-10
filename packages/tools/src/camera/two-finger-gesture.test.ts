import { describe, expect, it } from 'vitest';

import { screenToWorld, type Camera } from '@canvas/engine';

import { applyCameraOperation } from './camera-controller.js';
import { cameraOperationFor, type CameraInput } from './camera-input.js';
import { TwoFingerGesture } from './two-finger-gesture.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

function apply(camera: Camera, inputs: readonly CameraInput[]): Camera {
  return inputs.reduce((current, input) => {
    const context = { camera: current, contentBounds: undefined, selectionBounds: undefined };
    const operation = cameraOperationFor(input, context);
    return operation === undefined ? current : applyCameraOperation(current, operation);
  }, camera);
}

describe('TwoFingerGesture', () => {
  it('does nothing with one finger down', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 10, y: 10 });
    expect(gesture.pointerMove(1, { x: 50, y: 10 })).toEqual([]);
    expect(gesture.isActive).toBe(false);
  });

  it('pans by the midpoint when both fingers move together', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 100, y: 100 });
    gesture.pointerDown(2, { x: 200, y: 100 });
    expect(gesture.isActive).toBe(true);
    const first = gesture.pointerMove(1, { x: 120, y: 130 });
    const second = gesture.pointerMove(2, { x: 220, y: 130 });
    const camera = apply(CAMERA, [...first, ...second]);
    expect(camera.zoom).toBeCloseTo(1, 12);
    expect(camera.x).toBeCloseTo(-20, 9);
    expect(camera.y).toBeCloseTo(-30, 9);
  });

  it('zooms by the change in span about the midpoint, which stays fixed', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 250, y: 200 });
    gesture.pointerDown(2, { x: 350, y: 200 });
    const midpoint = { x: 300, y: 200 };
    const worldAtMidpoint = screenToWorld(CAMERA, midpoint);
    const inputs = [
      ...gesture.pointerMove(1, { x: 200, y: 200 }),
      ...gesture.pointerMove(2, { x: 400, y: 200 }),
    ];
    const camera = apply(CAMERA, inputs);
    expect(camera.zoom).toBeCloseTo(2, 12);
    const after = screenToWorld(camera, midpoint);
    expect(after.x).toBeCloseTo(worldAtMidpoint.x, 9);
    expect(after.y).toBeCloseTo(worldAtMidpoint.y, 9);
  });

  it('keeps the world point under the fingers when they pinch and move at once', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 100, y: 100 });
    gesture.pointerDown(2, { x: 200, y: 100 });
    const worldAtStart = screenToWorld(CAMERA, { x: 150, y: 100 });
    const inputs = [
      ...gesture.pointerMove(1, { x: 300, y: 300 }),
      ...gesture.pointerMove(2, { x: 500, y: 300 }),
    ];
    const camera = apply(CAMERA, inputs);
    const after = screenToWorld(camera, { x: 400, y: 300 });
    expect(camera.zoom).toBeCloseTo(2, 12);
    expect(after.x).toBeCloseTo(worldAtStart.x, 9);
    expect(after.y).toBeCloseTo(worldAtStart.y, 9);
  });

  it('stops when a finger lifts and ignores a third finger', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 0, y: 0 });
    gesture.pointerDown(2, { x: 100, y: 0 });
    gesture.pointerDown(3, { x: 50, y: 50 });
    expect(gesture.isActive).toBe(false);
    expect(gesture.pointerMove(3, { x: 60, y: 60 })).toEqual([]);
    gesture.pointerUp(3);
    expect(gesture.isActive).toBe(true);
    gesture.pointerUp(1);
    expect(gesture.isActive).toBe(false);
    expect(gesture.pointerMove(2, { x: 0, y: 0 })).toEqual([]);
  });

  it('ignores moves of a pointer it never saw go down', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 0, y: 0 });
    gesture.pointerDown(2, { x: 100, y: 0 });
    expect(gesture.pointerMove(9, { x: 5, y: 5 })).toEqual([]);
  });

  it('does not divide by a zero span when the fingers land on one spot', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 10, y: 10 });
    gesture.pointerDown(2, { x: 10, y: 10 });
    expect(gesture.pointerMove(2, { x: 30, y: 10 })).toEqual([
      { kind: 'drag', deltaXPx: 10, deltaYPx: 0 },
    ]);
  });
});
