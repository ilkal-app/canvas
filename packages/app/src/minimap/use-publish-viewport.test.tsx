// @vitest-environment jsdom
// The person's view, told to collaborators as the camera moves.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';

import { presenceViewportOf, usePublishViewport } from './use-publish-viewport.js';

afterEach(cleanup);

const CAMERA: Camera = {
  x: 10,
  y: 20,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

describe('presenceViewportOf', () => {
  it('is the camera’s region in world units with its zoom, and none without a screen', () => {
    expect(presenceViewportOf(CAMERA)).toEqual({ x: 10, y: 20, w: 400, h: 300, zoom: 2 });
    expect(presenceViewportOf({ ...CAMERA, viewportWidthPx: 0 })).toBeNull();
  });
});

describe('usePublishViewport', () => {
  it('tells the view now and as the camera moves, and none once unmounted', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const showViewport = vi.fn();
    const { unmount } = renderHook(() => {
      usePublishViewport({ showViewport }, camera);
    });
    camera.write({ ...CAMERA, x: 50 });
    unmount();
    expect(showViewport.mock.calls.map(([viewport]: unknown[]) => viewport)).toEqual([
      { x: 10, y: 20, w: 400, h: 300, zoom: 2 },
      { x: 50, y: 20, w: 400, h: 300, zoom: 2 },
      null,
    ]);
  });

  it('tells nothing before the camera reports, or without presence or a camera', () => {
    const camera = createCameraSource();
    const showViewport = vi.fn();
    renderHook(() => {
      usePublishViewport({ showViewport }, camera);
    });
    expect(showViewport).not.toHaveBeenCalled();
    renderHook(() => {
      usePublishViewport({}, camera);
    });
    renderHook(() => {
      usePublishViewport({ showViewport }, undefined);
    });
    expect(showViewport).not.toHaveBeenCalled();
  });
});
