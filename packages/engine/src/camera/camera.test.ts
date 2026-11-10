import { describe, expect, it } from 'vitest';

import {
  cameraClipTransform,
  isSameCamera,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
  type Camera,
} from './camera.js';

const CAMERA: Camera = {
  x: 100,
  y: -50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 2,
};

describe('worldToScreen and screenToWorld', () => {
  it('maps the camera position to the viewport top-left corner', () => {
    expect(worldToScreen(CAMERA, { x: 100, y: -50 })).toEqual({ x: 0, y: 0 });
  });

  it('scales world offsets by the zoom into CSS pixels', () => {
    expect(worldToScreen(CAMERA, { x: 110, y: -40 })).toEqual({ x: 20, y: 20 });
  });

  it('inverts each other', () => {
    const screen = { x: 123.5, y: 456.25 };
    expect(worldToScreen(CAMERA, screenToWorld(CAMERA, screen))).toEqual(screen);
    expect(screenToWorld(CAMERA, { x: 400, y: 300 })).toEqual({ x: 300, y: 100 });
  });

  it('does not mutate the camera or the point', () => {
    const camera = Object.freeze({ ...CAMERA });
    const point = Object.freeze({ x: 1, y: 2 });
    expect(() => screenToWorld(camera, worldToScreen(camera, point))).not.toThrow();
  });
});

describe('visibleWorldBounds', () => {
  it('spans the viewport in world units', () => {
    expect(visibleWorldBounds(CAMERA)).toEqual({ minX: 100, minY: -50, maxX: 500, maxY: 250 });
  });
});

describe('cameraClipTransform', () => {
  it('maps the viewport corners to the clip-space corners, y up', () => {
    const [scaleX, scaleY, offsetX, offsetY] = cameraClipTransform(CAMERA);
    const toClip = (x: number, y: number): [number, number] => [
      x * scaleX + offsetX,
      y * scaleY + offsetY,
    ];
    const expectClip = ([x, y]: [number, number], expected: [number, number]): void => {
      expect(x).toBeCloseTo(expected[0], 12);
      expect(y).toBeCloseTo(expected[1], 12);
    };
    expectClip(toClip(100, -50), [-1, 1]);
    expectClip(toClip(500, 250), [1, -1]);
    expectClip(toClip(300, 100), [0, 0]);
  });
});

describe('isSameCamera', () => {
  it('is true for equal fields and false when any field differs', () => {
    expect(isSameCamera(CAMERA, { ...CAMERA })).toBe(true);
    expect(isSameCamera(CAMERA, { ...CAMERA, x: 101 })).toBe(false);
    expect(isSameCamera(CAMERA, { ...CAMERA, zoom: 3 })).toBe(false);
    expect(isSameCamera(CAMERA, { ...CAMERA, viewportWidthPx: 801 })).toBe(false);
    expect(isSameCamera(CAMERA, { ...CAMERA, dpr: 1 })).toBe(false);
  });
});
