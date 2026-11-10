// @vitest-environment jsdom
// A phone floating canvas has pinch zoom only, even if a map was pinned.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { createZoomSource } from '../toolbar/zoom-source.js';

import { CanvasZoom } from './canvas-zoom.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('renders no zoom or minimap in compact floating chrome, while classic keeps zoom', () => {
  const props = {
    zoom: createZoomSource(),
    state: { isMinimapPinned: true, isLayersDrawerOpen: false },
    hasLayersDrawer: false,
    isFloating: true,
    isCompact: true,
    registry: createFloatingShortcutRegistry('mac'),
    dispatch: vi.fn(),
  };
  const view = render(<CanvasZoom {...props} />);
  expect(document.querySelector('[data-zoom-control]')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Minimap' })).toBeNull();
  expect(document.querySelector('[data-compact-minimap]')).toBeNull();
  view.rerender(<CanvasZoom {...props} isFloating={false} />);
  expect(document.querySelector('[data-zoom-control]')).not.toBeNull();
});
