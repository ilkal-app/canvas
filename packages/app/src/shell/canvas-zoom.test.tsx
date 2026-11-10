// @vitest-environment jsdom
// The zoom control over the canvas: floating with its map at desktop width
// under the floating chrome; the classic one otherwise, ending with the minimap toggle and
// showing the pinned map in the floating chrome's compact form.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { createZoomSource } from '../toolbar/zoom-source.js';

import { CanvasZoom, type CanvasZoomProps } from './canvas-zoom.js';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** An engine over an empty page. */
const ENGINE = {
  board: {
    board: { references: { childrenOf: () => [] }, get: () => undefined },
    subscribe: () => () => undefined,
  },
} as unknown as MountedEngine;

/**
 * The control in a form.
 *
 * @param fields - What differs from a pinned map under the floating chrome at desktop width.
 */
function show(fields: Partial<CanvasZoomProps>): void {
  const camera = createCameraSource();
  camera.write(CAMERA);
  render(
    <CanvasZoom
      zoom={createZoomSource()}
      camera={camera}
      engine={ENGINE}
      state={{ isMinimapPinned: true, isLayersDrawerOpen: false }}
      hasLayersDrawer={false}
      isFloating
      isCompact={false}
      registry={createFloatingShortcutRegistry('mac')}
      dispatch={vi.fn()}
      {...fields}
    />,
  );
}

describe('CanvasZoom', () => {
  it('is the floating control with its map under the floating chrome at desktop width', () => {
    show({});
    expect(document.querySelector('[data-floating-zoom][data-open]')).not.toBeNull();
    expect(document.querySelector('[data-compact-minimap]')).toBeNull();
  });

  it('shows no control and no map in the compact form, where a phone pinches', () => {
    show({ isCompact: true });
    expect(document.querySelector('[data-zoom-control]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Minimap' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Minimap' })).toBeNull();
  });

  it('is the classic control, with no minimap toggle, under the classic chrome', () => {
    show({ isFloating: false, hasLayersDrawer: true });
    expect(screen.queryByRole('button', { name: 'Minimap' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Layers' })).toBeTruthy();
    cleanup();
    show({ isFloating: false, isCompact: true, engine: undefined });
    expect(screen.queryByRole('button', { name: 'Minimap' })).toBeNull();
  });
});
