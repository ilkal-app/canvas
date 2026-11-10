import { describe, expect, it } from 'vitest';

import { RuntimeCamera } from './runtime-camera.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

describe('RuntimeCamera', () => {
  it('has no camera to draw with until one is set, and ignores a resize before then', () => {
    const camera = new RuntimeCamera();

    camera.resize(1600, 1200, 2);

    expect(camera.at(0)).toBeUndefined();
  });

  it('jumps to the first camera it is asked to animate to', () => {
    const camera = new RuntimeCamera();

    camera.animate({ ...CAMERA, zoom: 2 }, 300);

    expect(camera.isAnimating).toBe(false);
    expect(camera.at(0)?.zoom).toBe(2);
  });

  it('animates towards a camera over its duration, then stops', () => {
    const camera = new RuntimeCamera();
    camera.set(CAMERA);
    camera.animate({ ...CAMERA, x: 100 }, 100);

    const start = camera.at(1000);
    const end = camera.at(1200);

    expect(start?.x).toBe(0);
    expect(end?.x).toBe(100);
    expect(camera.isAnimating).toBe(false);
  });

  it('gives the camera the new viewport on resize, and stops an animation on a fault', () => {
    const camera = new RuntimeCamera();
    camera.set(CAMERA);
    camera.animate({ ...CAMERA, x: 100 }, 100);

    camera.resize(1600, 1200, 2);
    camera.stop();

    expect(camera.isAnimating).toBe(false);
    expect(camera.at(0)).toMatchObject({ viewportWidthPx: 800, viewportHeightPx: 600, dpr: 2 });
  });
});
