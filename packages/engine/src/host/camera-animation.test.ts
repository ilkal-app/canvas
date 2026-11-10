import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { CameraAnimation, interpolateCamera } from './camera-animation.js';

const VIEW = { viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };
const FROM: Camera = { x: 0, y: 0, zoom: 1, ...VIEW };
const TO: Camera = { x: 100, y: 40, zoom: 4, ...VIEW };

/**
 * The world point at the viewport's centre.
 *
 * @param camera - The camera.
 * @returns The point, world units.
 */
function centreOf(camera: Camera): { x: number; y: number } {
  return {
    x: camera.x + camera.viewportWidthPx / 2 / camera.zoom,
    y: camera.y + camera.viewportHeightPx / 2 / camera.zoom,
  };
}

describe('interpolateCamera', () => {
  it('starts at the first camera and ends at the second', () => {
    expect(interpolateCamera(FROM, TO, 0, VIEW)).toEqual(FROM);
    const end = interpolateCamera(FROM, TO, 1, VIEW);
    expect(end.x).toBeCloseTo(TO.x, 10);
    expect(end.y).toBeCloseTo(TO.y, 10);
    expect(end.zoom).toBeCloseTo(TO.zoom, 10);
  });

  it('zooms geometrically, so each step scales the view by the same factor', () => {
    expect(interpolateCamera(FROM, TO, 0.5, VIEW).zoom).toBeCloseTo(2, 10);
    expect(interpolateCamera(FROM, TO, 0.25, VIEW).zoom).toBeCloseTo(Math.SQRT2, 10);
  });

  it('moves the viewport centre in a straight line', () => {
    const halfway = centreOf(interpolateCamera(FROM, TO, 0.5, VIEW));
    const [start, end] = [centreOf(FROM), centreOf(TO)];
    expect(halfway.x).toBeCloseTo((start.x + end.x) / 2, 10);
    expect(halfway.y).toBeCloseTo((start.y + end.y) / 2, 10);
  });

  it('clamps progress to [0, 1] and takes the viewport it is given', () => {
    const view = { viewportWidthPx: 50, viewportHeightPx: 20, dpr: 2 };
    expect(interpolateCamera(FROM, TO, 2, view)).toMatchObject({ zoom: 4, ...view });
    expect(interpolateCamera(FROM, TO, -1, view).zoom).toBe(1);
  });

  it('takes only the viewport fields when handed a whole camera as the viewport', () => {
    const wholeCamera: Camera = { ...TO, zoom: 99 };
    expect(interpolateCamera(FROM, TO, 0.5, wholeCamera).zoom).toBeCloseTo(2, 10);
  });
});

describe('CameraAnimation', () => {
  it('starts on its first frame and ends after its duration', () => {
    const animation = new CameraAnimation(FROM, TO, 100);
    expect(animation.cameraAt(1_000, VIEW).zoom).toBe(1);
    expect(animation.isFinished).toBe(false);
    expect(animation.cameraAt(1_050, VIEW).zoom).toBeCloseTo(2, 10);
    expect(animation.cameraAt(1_100, VIEW).zoom).toBeCloseTo(4, 10);
    expect(animation.isFinished).toBe(true);
  });

  it('jumps straight to the target when the duration is not positive', () => {
    const animation = new CameraAnimation(FROM, TO, 0);
    expect(animation.cameraAt(5, VIEW).zoom).toBeCloseTo(4, 10);
    expect(animation.isFinished).toBe(true);
  });
});
