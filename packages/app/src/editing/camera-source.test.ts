import { describe, expect, it, vi } from 'vitest';

import { createCameraSource } from './camera-source.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

describe('createCameraSource', () => {
  it('starts empty and tells listeners only of a camera that differs', () => {
    const source = createCameraSource();
    expect(source.read()).toBeUndefined();
    const listener = vi.fn();
    const stop = source.subscribe(listener);
    source.write(CAMERA);
    source.write({ ...CAMERA });
    expect(listener).toHaveBeenCalledTimes(1);
    source.write({ ...CAMERA, x: 5 });
    source.write({ ...CAMERA, x: 5, dpr: 2 });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(source.read()).toEqual({ ...CAMERA, x: 5, dpr: 2 });
    stop();
    source.write(CAMERA);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
