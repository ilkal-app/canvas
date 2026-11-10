// CONTRACT: renewed camera motion restarts the 1.5 s linger and its fade phase;
// pinning keeps the map visible without entering the fading state.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { MOTION_FADE_MS, MOTION_LINGER_MS } from '../minimap/use-camera-motion.js';

import { FloatingZoom } from './floating-zoom.js';
import { createZoomSource } from './zoom-source.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const BOARD = {
  board: { references: { childrenOf: () => [] }, get: () => undefined },
  subscribe: () => () => undefined,
} as unknown as BoardView;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('floating map fade acceptance', () => {
  it('restarts fading after renewed movement and never fades while pinned', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const props = {
      camera,
      board: BOARD,
      zoom: createZoomSource(),
      registry: createFloatingShortcutRegistry('mac'),
      dispatch: vi.fn(),
    };
    const view = render(<FloatingZoom {...props} isMinimapPinned={false} />);
    const group = screen.getByRole('group', { name: 'Zoom' });
    act(() => {
      camera.write({ ...CAMERA, x: 10 });
    });
    expect(group.hasAttribute('data-open')).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - MOTION_FADE_MS);
      await Promise.resolve();
    });
    expect(group.querySelector('[data-fading]')).not.toBeNull();
    act(() => {
      camera.write({ ...CAMERA, x: 20 });
    });
    expect(group.querySelector('[data-fading]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - MOTION_FADE_MS);
      await Promise.resolve();
    });
    expect(group.querySelector('[data-fading]')).not.toBeNull();
    view.rerender(<FloatingZoom {...props} isMinimapPinned />);
    expect(group.hasAttribute('data-open')).toBe(true);
    expect(group.querySelector('[data-fading]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(MOTION_LINGER_MS + 1);
      await Promise.resolve();
    });
    expect(group.hasAttribute('data-open')).toBe(true);
    expect(group.querySelector('[data-fading]')).toBeNull();
  });
});
