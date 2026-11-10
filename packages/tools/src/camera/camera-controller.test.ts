import { describe, expect, it } from 'vitest';

import { screenToWorld, type Camera } from '@canvas/engine';

import { applyCameraOperation, type CameraOperation } from './camera-controller.js';

const CAMERA: Camera = Object.freeze({
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1000,
  viewportHeightPx: 500,
  dpr: 1,
});

describe('applyCameraOperation', () => {
  it('pans by a screen delta', () => {
    expect(applyCameraOperation(CAMERA, { type: 'panBy', deltaXPx: 10, deltaYPx: 20 })).toEqual({
      ...CAMERA,
      x: -10,
      y: -20,
    });
  });

  it('zooms about a point, keeping it fixed', () => {
    const point = { x: 250, y: 100 };
    const zoomed = applyCameraOperation(CAMERA, { type: 'zoomAt', point, factor: 4 });
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(zoomed, point)).toEqual(screenToWorld(CAMERA, point));
  });

  it('zooms to a level about the viewport centre', () => {
    const zoomed = applyCameraOperation(CAMERA, { type: 'zoomTo', zoom: 2 });
    expect(zoomed).toEqual({ ...CAMERA, zoom: 2, x: 250, y: 125 });
  });

  it('fits a rectangle with padding', () => {
    const fitted = applyCameraOperation(CAMERA, {
      type: 'fitToRect',
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      paddingPx: 50,
    });
    // 900 × 400 available: 400 / 100 = 4 limits (900 / 200 = 4.5); the 800 × 400 px rect is
    // centred, so 50 px (12.5 world units) stay clear above it.
    expect(fitted).toEqual({ ...CAMERA, zoom: 4, x: -25, y: -12.5 });
  });

  it('fits the selection, and leaves the camera alone when nothing is selected', () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    expect(applyCameraOperation(CAMERA, { type: 'fitToSelection', bounds, paddingPx: 50 })).toEqual(
      { ...CAMERA, zoom: 4, x: -25, y: -12.5 },
    );
    expect(
      applyCameraOperation(CAMERA, { type: 'fitToSelection', bounds: undefined, paddingPx: 50 }),
    ).toBe(CAMERA);
  });

  it('resets to the origin at 100%', () => {
    const moved = { ...CAMERA, x: 3, y: 4, zoom: 8 };
    expect(applyCameraOperation(moved, { type: 'resetToOrigin' })).toEqual(CAMERA);
  });

  it('never changes the camera it is given', () => {
    const operations: CameraOperation[] = [
      { type: 'panBy', deltaXPx: 1, deltaYPx: 1 },
      { type: 'zoomAt', point: { x: 0, y: 0 }, factor: 2 },
      { type: 'zoomTo', zoom: 3 },
      { type: 'resetToOrigin' },
    ];
    for (const operation of operations) applyCameraOperation(CAMERA, operation);
    expect(CAMERA).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
      viewportWidthPx: 1000,
      viewportHeightPx: 500,
      dpr: 1,
    });
  });
});
