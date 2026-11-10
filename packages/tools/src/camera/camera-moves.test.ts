import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, type Camera } from '@canvas/engine';

import {
  fitCameraToRect,
  panCamera,
  resetCameraToOrigin,
  resizeCameraViewport,
  zoomCameraAt,
  zoomCameraTo,
  type ScreenPoint,
} from './camera-moves.js';

/**
 * Asserts where a world point lands on screen, to within float rounding.
 *
 * @param camera - The camera.
 * @param world - The world point.
 * @param expected - The expected screen point, CSS px.
 */
function expectOnScreen(
  camera: Camera,
  world: Parameters<typeof worldToScreen>[1],
  expected: ScreenPoint,
): void {
  const actual = worldToScreen(camera, world);
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

const CAMERA: Camera = Object.freeze({
  x: 100,
  y: -50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 2,
});

describe('panCamera', () => {
  it('moves the board on screen by the drag, in CSS pixels', () => {
    const panned = panCamera(CAMERA, 40, -20);
    expect(panned).toEqual({ ...CAMERA, x: 80, y: -40 });
    const worldPoint = { x: 150, y: 0 };
    const before = worldToScreen(CAMERA, worldPoint);
    expect(worldToScreen(panned, worldPoint)).toEqual({ x: before.x + 40, y: before.y - 20 });
  });

  it('returns a new camera and leaves its input alone', () => {
    const panned = panCamera(CAMERA, 1, 1);
    expect(panned).not.toBe(CAMERA);
    expect(CAMERA.x).toBe(100);
  });
});

describe('zoomCameraAt', () => {
  it('keeps the world point under the cursor fixed on screen', () => {
    const cursor = { x: 300, y: 200 };
    const worldUnderCursor = screenToWorld(CAMERA, cursor);
    const zoomed = zoomCameraAt(CAMERA, cursor, 2);
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(zoomed, cursor)).toEqual(worldUnderCursor);
    // At zoom 2 the cursor shows world (250, 50); at zoom 4 that point is 300 px from x = 175.
    expect(zoomed).toEqual({ ...CAMERA, zoom: 4, x: 175, y: 0 });
  });

  it('keeps the point fixed when the zoom stops at a bound', () => {
    const cursor = { x: 640, y: 10 };
    const worldUnderCursor = screenToWorld(CAMERA, cursor);
    const zoomed = zoomCameraAt(CAMERA, cursor, 1000);
    expect(zoomed.zoom).toBe(MAX_ZOOM);
    const after = screenToWorld(zoomed, cursor);
    expect(after.x).toBeCloseTo(worldUnderCursor.x, 9);
    expect(after.y).toBeCloseTo(worldUnderCursor.y, 9);
  });

  it('clamps at both ends of the 0.02×–64× range', () => {
    expect(zoomCameraAt(CAMERA, { x: 0, y: 0 }, 1e6).zoom).toBe(64);
    expect(zoomCameraAt(CAMERA, { x: 0, y: 0 }, 1e-6).zoom).toBe(0.02);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.02, 64]);
  });

  it('returns the same camera when already at the bound it is pushed against', () => {
    const atMax = { ...CAMERA, zoom: MAX_ZOOM };
    expect(zoomCameraAt(atMax, { x: 5, y: 5 }, 2)).toBe(atMax);
  });

  it('refuses a factor that is not a positive finite number', () => {
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => zoomCameraAt(CAMERA, { x: 0, y: 0 }, factor)).toThrow(RangeError);
    }
  });
});

describe('zoomCameraTo', () => {
  it('sets the zoom about the viewport centre', () => {
    const centre = { x: 400, y: 300 };
    const worldAtCentre = screenToWorld(CAMERA, centre);
    const zoomed = zoomCameraTo(CAMERA, 1);
    expect(zoomed.zoom).toBe(1);
    expect(screenToWorld(zoomed, centre)).toEqual(worldAtCentre);
  });

  it('clamps the requested level', () => {
    expect(zoomCameraTo(CAMERA, 500).zoom).toBe(64);
    expect(zoomCameraTo(CAMERA, 0.001).zoom).toBe(0.02);
  });
});

describe('fitCameraToRect', () => {
  it('fits the limiting axis inside the padding and centres the other', () => {
    // 800 × 600 viewport, 50 px padding: 700 × 500 available. A 1400 × 500 rect is limited by
    // its width: zoom 0.5; it is then 250 px tall, centred vertically.
    const bounds = { minX: 1000, minY: 2000, maxX: 2400, maxY: 2500 };
    const fitted = fitCameraToRect(CAMERA, bounds, 50);
    expect(fitted.zoom).toBe(0.5);
    expectOnScreen(fitted, { x: bounds.minX, y: bounds.minY }, { x: 50, y: 175 });
    expectOnScreen(fitted, { x: bounds.maxX, y: bounds.maxY }, { x: 750, y: 425 });
  });

  it('fits a tall rect by its height', () => {
    const fitted = fitCameraToRect(CAMERA, { minX: 0, minY: 0, maxX: 100, maxY: 1000 }, 0);
    expect(fitted.zoom).toBe(0.6);
    expectOnScreen(fitted, { x: 50, y: 500 }, { x: 400, y: 300 });
  });

  it('clamps the fitted zoom at both bounds, still centring the rect', () => {
    const tiny = fitCameraToRect(CAMERA, { minX: 10, minY: 10, maxX: 11, maxY: 11 }, 0);
    expect(tiny.zoom).toBe(MAX_ZOOM);
    expectOnScreen(tiny, { x: 10.5, y: 10.5 }, { x: 400, y: 300 });
    const huge = fitCameraToRect(CAMERA, { minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, 0);
    expect(huge.zoom).toBe(MIN_ZOOM);
    expectOnScreen(huge, { x: 5e5, y: 5e5 }, { x: 400, y: 300 });
  });

  it('centres a point-sized rect without changing the zoom', () => {
    const fitted = fitCameraToRect(CAMERA, { minX: 7, minY: 9, maxX: 7, maxY: 9 }, 20);
    expect(fitted.zoom).toBe(CAMERA.zoom);
    expectOnScreen(fitted, { x: 7, y: 9 }, { x: 400, y: 300 });
  });

  it('keeps at least one pixel to fit into when the padding swallows the viewport', () => {
    const fitted = fitCameraToRect(CAMERA, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);
    expect(fitted.zoom).toBe(0.1);
  });

  it('refuses inverted bounds and a negative padding', () => {
    expect(() => fitCameraToRect(CAMERA, { minX: 5, minY: 0, maxX: 0, maxY: 1 }, 0)).toThrow(
      RangeError,
    );
    expect(() => fitCameraToRect(CAMERA, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, -1)).toThrow(
      RangeError,
    );
  });
});

describe('resetCameraToOrigin', () => {
  it('puts the world origin at the viewport top-left at 100%, keeping the viewport', () => {
    expect(resetCameraToOrigin(CAMERA)).toEqual({ ...CAMERA, x: 0, y: 0, zoom: 1 });
  });
});

describe('resizeCameraViewport', () => {
  it('keeps the top-left corner and zoom and takes the new size and pixel ratio', () => {
    expect(resizeCameraViewport(CAMERA, { cssWidthPx: 1024, cssHeightPx: 768, dpr: 1 })).toEqual({
      ...CAMERA,
      viewportWidthPx: 1024,
      viewportHeightPx: 768,
      dpr: 1,
    });
  });

  it('returns the same camera when nothing changed', () => {
    expect(resizeCameraViewport(CAMERA, { cssWidthPx: 800, cssHeightPx: 600, dpr: 2 })).toBe(
      CAMERA,
    );
  });
});
