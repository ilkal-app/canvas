// CONTRACT: the floating control exposes its closed and open rows, the pin's
// keyboard hint and pressed state, and a minimap only when both board and camera are present.
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { FloatingZoom } from './floating-zoom.js';
import { createZoomSource } from './zoom-source.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const BOARD = {
  board: { references: { childrenOf: () => [] }, get: () => undefined },
  subscribe: () => () => undefined,
} as unknown as BoardView;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    expect(callback).toBeTypeOf('function');
    return 1;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('floating zoom control acceptance', () => {
  it('shows the ordered closed row, popover avoidance, and the shift+m hint', () => {
    const zoom = createZoomSource();
    zoom.write(1);
    render(
      <FloatingZoom
        zoom={zoom}
        isMinimapPinned={false}
        registry={createDefaultShortcutRegistry('mac')}
        dispatch={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group.hasAttribute('data-open')).toBe(false);
    expect(group.hasAttribute('data-popover-avoid')).toBe(true);
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Zoom out', 'Zoom presets', 'Zoom in', 'Zoom to fit', 'Minimap']);
    expect(within(group).getByRole('status', { name: 'Zoom level' }).textContent).toBe('100%');
    expect(group.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    expect(within(group).queryByRole('img', { name: /^Minimap/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Minimap' }).title).toMatch(/⇧M/);
  });

  it('opens only with board and camera, then exposes the caption, map, and pressed pin', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const props = {
      zoom: createZoomSource(),
      registry: createDefaultShortcutRegistry('mac'),
      dispatch: vi.fn(),
      isMinimapPinned: true,
    };
    const view = render(<FloatingZoom {...props} />);
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group.hasAttribute('data-open')).toBe(false);
    view.rerender(<FloatingZoom {...props} camera={camera} />);
    expect(group.hasAttribute('data-open')).toBe(false);
    view.rerender(<FloatingZoom {...props} board={BOARD} />);
    expect(group.hasAttribute('data-open')).toBe(false);
    view.rerender(<FloatingZoom {...props} board={BOARD} camera={camera} />);
    expect(group.hasAttribute('data-open')).toBe(true);
    expect(within(group).getByText('Shows while you pan or zoom')).toBeTruthy();
    expect(within(group).getByRole('img', { name: /^Minimap/ })).toBeTruthy();
    expect(group.querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Minimap' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    view.rerender(
      <FloatingZoom {...props} isMinimapPinned={false} board={BOARD} camera={camera} />,
    );
    expect(screen.getByRole('button', { name: 'Minimap' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(group.hasAttribute('data-open')).toBe(false);
  });
});
