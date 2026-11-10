// CONTRACT: only a reported pan or zoom opens the transient map; resize and DPR
// reports do not, each move restarts the 1.5 s linger, and unmount removes the pending timer.
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';

import { MOTION_LINGER_MS, useCameraMotion } from './use-camera-motion.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

afterEach(() => vi.useRealTimers());

describe('camera motion acceptance', () => {
  it('ignores the first report, resize, and DPR changes even when bundled with motion', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    const hook = renderHook(() => useCameraMotion(camera));
    for (const next of [
      CAMERA,
      { ...CAMERA, viewportWidthPx: 900 },
      { ...CAMERA, viewportWidthPx: 900, dpr: 2 },
      { ...CAMERA, viewportWidthPx: 900, dpr: 3, x: 40 },
    ]) {
      act(() => {
        camera.write(next);
      });
      expect(hook.result.current).toBe(false);
    }
    act(() => {
      camera.write({ ...CAMERA, viewportWidthPx: 900, dpr: 3, x: 41 });
    });
    expect(hook.result.current).toBe(true);
    hook.unmount();
  });

  it('restarts linger on every pan or zoom and clears its timer on unmount', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const hook = renderHook(() => useCameraMotion(camera));
    act(() => {
      camera.write({ ...CAMERA, x: 1 });
    });
    expect(hook.result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - 1);
    });
    act(() => {
      camera.write({ ...CAMERA, x: 1, zoom: 2 });
    });
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - 1);
    });
    expect(hook.result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.result.current).toBe(false);
    act(() => {
      camera.write({ ...CAMERA, x: 2, zoom: 2 });
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
