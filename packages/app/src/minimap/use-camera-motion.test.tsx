// @vitest-environment jsdom
// Whether the camera is moving, which opens the floating zoom control's minimap.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';

import { isCameraMotion, MOTION_LINGER_MS, useCameraMotion } from './use-camera-motion.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

afterEach(() => {
  vi.useRealTimers();
});

describe('isCameraMotion', () => {
  it('is a pan or a zoom, not the first report or a resize', () => {
    expect(isCameraMotion(undefined, CAMERA)).toBe(false);
    expect(isCameraMotion(CAMERA, undefined)).toBe(false);
    expect(isCameraMotion(CAMERA, { ...CAMERA })).toBe(false);
    expect(isCameraMotion(CAMERA, { ...CAMERA, x: 5 })).toBe(true);
    expect(isCameraMotion(CAMERA, { ...CAMERA, y: 5 })).toBe(true);
    expect(isCameraMotion(CAMERA, { ...CAMERA, zoom: 2 })).toBe(true);
    expect(isCameraMotion(CAMERA, { ...CAMERA, x: 5, viewportWidthPx: 900 })).toBe(false);
    expect(isCameraMotion(CAMERA, { ...CAMERA, viewportHeightPx: 700 })).toBe(false);
    expect(isCameraMotion(CAMERA, { ...CAMERA, zoom: 2, dpr: 2 })).toBe(false);
  });
});

describe('useCameraMotion', () => {
  it('is true from a pan until the linger after the last one', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    const { result, unmount } = renderHook(() => useCameraMotion(camera));
    act(() => {
      camera.write(CAMERA);
    });
    expect(result.current).toBe(false);
    act(() => {
      camera.write({ ...CAMERA, x: 10 });
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - 100);
      camera.write({ ...CAMERA, x: 20 });
      vi.advanceTimersByTime(MOTION_LINGER_MS - 100);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);
    act(() => {
      camera.write({ ...CAMERA, x: 20, viewportWidthPx: 1000 });
    });
    expect(result.current).toBe(false);
    unmount();
  });

  it('is false without a camera', () => {
    const { result } = renderHook(() => useCameraMotion(undefined));
    expect(result.current).toBe(false);
  });
});
