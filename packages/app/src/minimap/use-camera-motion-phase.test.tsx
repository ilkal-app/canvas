// @vitest-environment jsdom
// The camera's motion phase: moving, then fading for the linger's last 160 ms, then
// still, which the floating zoom control's minimap fades out by.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';

import { MOTION_FADE_MS, MOTION_LINGER_MS, useCameraMotionPhase } from './use-camera-motion.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

afterEach(() => {
  vi.useRealTimers();
});

describe('useCameraMotionPhase', () => {
  it('moves, fades for the linger’s last part, then is still', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { result } = renderHook(() => useCameraMotionPhase(camera));
    expect(result.current).toBe('still');
    act(() => {
      camera.write({ ...CAMERA, x: 5 });
    });
    expect(result.current).toBe('moving');
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - MOTION_FADE_MS);
    });
    expect(result.current).toBe('fading');
    act(() => {
      camera.write({ ...CAMERA, x: 9 });
    });
    expect(result.current).toBe('moving');
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS);
    });
    expect(result.current).toBe('still');
  });

  it('fades at once for a linger shorter than the fade', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { result } = renderHook(() => useCameraMotionPhase(camera, 50));
    act(() => {
      camera.write({ ...CAMERA, zoom: 2 });
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('fading');
  });
});
