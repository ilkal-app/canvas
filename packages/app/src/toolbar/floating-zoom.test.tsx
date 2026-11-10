// @vitest-environment jsdom
// The floating zoom control and its minimap (/632). In Chrome:
// tooling/scenario/specs/app/floating-zoom.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { MOTION_FADE_MS, MOTION_LINGER_MS } from '../minimap/use-camera-motion.js';
import { createShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { FloatingZoom } from './floating-zoom.js';
import { createZoomSource } from './zoom-source.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** An empty page. */
const BOARD = {
  board: { references: { childrenOf: () => [] }, get: () => undefined },
  subscribe: () => () => undefined,
} as unknown as BoardView;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('FloatingZoom', () => {
  it('is the zoom row ending with the minimap toggle, kept clear of popovers', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const zoom = createZoomSource();
    render(
      <FloatingZoom
        zoom={zoom}
        isMinimapPinned={false}
        registry={createDefaultShortcutRegistry('mac')}
        dispatch={dispatch}
      />,
    );
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group.hasAttribute('data-popover-avoid')).toBe(true);
    expect(group.hasAttribute('data-open')).toBe(false);
    act(() => {
      zoom.write(0.64);
    });
    expect(within(group).getByRole('status', { name: 'Zoom level' }).textContent).toBe('64%');
    const names = within(group)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Zoom out', 'Zoom presets', 'Zoom in', 'Zoom to fit', 'Minimap']);
    const toggle = screen.getByRole('button', { name: 'Minimap' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.title).toBe('Minimap (⇧M)');
    expect(fireEvent.mouseDown(toggle)).toBe(false);
    fireEvent.click(toggle);
    expect(dispatch).toHaveBeenCalledWith({ type: 'navigate', command: 'toggleMinimap' });
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('names the toggle without a shortcut where the registry has none', () => {
    render(
      <FloatingZoom
        zoom={createZoomSource()}
        isMinimapPinned={false}
        registry={createShortcutRegistry<ShellAction>('mac')}
        dispatch={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Minimap' }).title).toBe('Minimap');
  });

  it('opens with the map while pinned, and only with a board and a camera', () => {
    const props = {
      zoom: createZoomSource(),
      registry: createDefaultShortcutRegistry('other'),
      dispatch: vi.fn<(action: ShellAction) => void>(),
    };
    const camera = createCameraSource();
    const { rerender } = render(<FloatingZoom {...props} isMinimapPinned camera={camera} />);
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<FloatingZoom {...props} isMinimapPinned camera={camera} board={BOARD} />);
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group.hasAttribute('data-open')).toBe(true);
    expect(within(group).getByText('Shows while you pan or zoom')).toBeTruthy();
    expect(within(group).getByRole('img', { name: /^Minimap/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimap' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens while the camera moves and closes after it settles', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    camera.write(CAMERA);
    render(
      <FloatingZoom
        zoom={createZoomSource()}
        camera={camera}
        board={BOARD}
        isMinimapPinned={false}
        registry={createDefaultShortcutRegistry('other')}
        dispatch={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group.hasAttribute('data-open')).toBe(false);
    act(() => {
      camera.write({ ...CAMERA, zoom: 1.5 });
    });
    expect(group.hasAttribute('data-open')).toBe(true);
    expect(screen.getByRole('button', { name: 'Minimap' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS);
    });
    expect(group.hasAttribute('data-open')).toBe(false);
  });

  it('fades the map out over the end of its linger, unless pinned', () => {
    vi.useFakeTimers();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const props = {
      zoom: createZoomSource(),
      camera,
      board: BOARD,
      registry: createDefaultShortcutRegistry('other'),
      dispatch: vi.fn(),
    };
    const { rerender } = render(<FloatingZoom {...props} isMinimapPinned={false} />);
    act(() => {
      camera.write({ ...CAMERA, x: 3 });
    });
    const area = () => document.querySelector('[data-floating-zoom] > div');
    expect(area()?.hasAttribute('data-fading')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(MOTION_LINGER_MS - MOTION_FADE_MS);
    });
    expect(area()?.hasAttribute('data-fading')).toBe(true);
    rerender(<FloatingZoom {...props} isMinimapPinned />);
    expect(area()?.hasAttribute('data-fading')).toBe(false);
  });
});
