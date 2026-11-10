import { describe, expect, it } from 'vitest';

import { cameraClipTransform, type Camera } from '../../camera/camera.js';

import {
  canvasDeviceRect,
  LAYER_RECT_MARGIN_PX,
  layerCamera,
  layerDeviceRect,
} from './layer-rect.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 2 };
const CANVAS = canvasDeviceRect(CAMERA);

describe('layer rectangles', () => {
  it('measures the canvas in device pixels', () => {
    expect(CANVAS).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('rounds content outward to whole device pixels plus the margin', () => {
    const rect = layerDeviceRect({ minX: 10.2, minY: 5, maxX: 20.6, maxY: 15 }, CAMERA, CANVAS);
    const margin = LAYER_RECT_MARGIN_PX;
    expect(rect).toEqual({
      x: 20 - margin,
      y: 10 - margin,
      width: 42 - 20 + 2 * margin,
      height: 20 + 2 * margin,
    });
  });

  it('does not lose a pixel to floating-point noise on a boundary', () => {
    const rect = layerDeviceRect(
      { minX: 19.999999999999996, minY: 0, maxX: 30.000000000000004, maxY: 10 },
      { ...CAMERA, dpr: 1 },
      { x: 0, y: 0, width: 1000, height: 1000 },
    );
    expect(rect).toEqual({ x: 19, y: 0, width: 12, height: 11 });
  });

  it('cuts to the rectangle it must stay inside, and is empty outside it', () => {
    expect(layerDeviceRect({ minX: -50, minY: -50, maxX: 10, maxY: 10 }, CAMERA, CANVAS)).toEqual({
      x: 0,
      y: 0,
      width: 21,
      height: 21,
    });
    const parent = { x: 100, y: 100, width: 50, height: 50 };
    expect(layerDeviceRect({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, CAMERA, parent)).toEqual(
      parent,
    );
    expect(layerDeviceRect({ minX: 300, minY: 0, maxX: 310, maxY: 10 }, CAMERA, CANVAS)).toBe(
      undefined,
    );
  });

  it('moves the camera so the target’s pixel (0, 0) is the rectangle’s origin', () => {
    const rect = { x: 40, y: 20, width: 30, height: 10 };
    const target = { width: 32, height: 16 };
    const moved = layerCamera({ ...CAMERA, x: 5, y: 7 }, rect, target);
    expect(moved).toMatchObject({ zoom: 1, dpr: 2, viewportWidthPx: 16, viewportHeightPx: 8 });
    // World (x + 20, y + 10) is canvas device pixel (40, 20): the target's top-left corner, clip
    // (−1, 1) under the moved camera.
    const [scaleX, scaleY, offsetX, offsetY] = cameraClipTransform(moved);
    expect(25 * scaleX + offsetX).toBeCloseTo(-1);
    expect(17 * scaleY + offsetY).toBeCloseTo(1);
  });
});
