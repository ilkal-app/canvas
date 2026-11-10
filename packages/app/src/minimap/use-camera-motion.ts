import { useEffect, useState } from 'react';

import type { Camera } from '@canvas/engine';

import type { CameraSource } from '../editing/camera-source.js';

/** How long the minimap stays open after the camera last moved, ms. */
export const MOTION_LINGER_MS = 1500;

/**
 * Whether the camera moved between two readings: a pan or a zoom, not the viewport resizing or
 * the engine's first report.
 *
 * @param previous - The camera before, or undefined before the engine reported one.
 * @param next - The camera now.
 * @returns True for a pan or a zoom.
 */
export function isCameraMotion(previous: Camera | undefined, next: Camera | undefined): boolean {
  if (previous === undefined || next === undefined) return false;
  if (
    previous.viewportWidthPx !== next.viewportWidthPx ||
    previous.viewportHeightPx !== next.viewportHeightPx ||
    previous.dpr !== next.dpr
  ) {
    return false;
  }
  return previous.x !== next.x || previous.y !== next.y || previous.zoom !== next.zoom;
}

/** How long the minimap fades out, ms: the last part of {@link MOTION_LINGER_MS}. */
export const MOTION_FADE_MS = 160;

/**
 * Where the camera's motion is: `moving` from a pan or a zoom (`isCameraMotion`), `fading` for
 * the last {@link MOTION_FADE_MS} of the {@link MOTION_LINGER_MS} after the last one, then
 * `still`; so the floating zoom control's minimap shows while the person pans or zooms ("Shows
 * while you pan or zoom") and fades out at its end. `still` without a camera.
 *
 * @param camera - The camera, or undefined.
 * @param lingerMs - How long after the last move it is not `still`; {@link MOTION_LINGER_MS} if
 *   absent.
 * @returns The phase.
 */
export function useCameraMotionPhase(
  camera: CameraSource | undefined,
  lingerMs: number = MOTION_LINGER_MS,
): 'still' | 'moving' | 'fading' {
  const [phase, setPhase] = useState<'still' | 'moving' | 'fading'>('still');
  useEffect(() => {
    if (camera === undefined) return undefined;
    let previous = camera.read();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clear = (): void => {
      for (const timer of timers.splice(0)) clearTimeout(timer);
    };
    const stop = camera.subscribe(() => {
      const next = camera.read();
      const didMove = isCameraMotion(previous, next);
      previous = next;
      if (!didMove) return;
      setPhase('moving');
      clear();
      const fadeAt = Math.max(lingerMs - MOTION_FADE_MS, 0);
      timers.push(
        setTimeout(() => {
          setPhase('fading');
        }, fadeAt),
        setTimeout(() => {
          setPhase('still');
        }, lingerMs),
      );
    });
    return () => {
      stop();
      clear();
    };
  }, [camera, lingerMs]);
  return phase;
}

/**
 * Whether the camera is moving: true from a pan or a zoom (`isCameraMotion`) until
 * {@link MOTION_LINGER_MS} after the last one (`useCameraMotionPhase`, fading included). False
 * without a camera.
 *
 * @param camera - The camera, or undefined.
 * @param lingerMs - How long it stays true after the last move; {@link MOTION_LINGER_MS} if absent.
 * @returns Whether it moved within the last `lingerMs`.
 */
export function useCameraMotion(
  camera: CameraSource | undefined,
  lingerMs: number = MOTION_LINGER_MS,
): boolean {
  return useCameraMotionPhase(camera, lingerMs) !== 'still';
}
