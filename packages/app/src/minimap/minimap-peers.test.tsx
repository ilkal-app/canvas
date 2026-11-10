// @vitest-environment jsdom
// The minimap's collaborators and wheel: their views stroked in their colours on the
// page shown, again when presence changes; a wheel on the map zooms about the point under it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { colorForPrincipal, type PresenceSnapshot, type PresenceState } from '@canvas/collab';
import type { Camera } from '@canvas/engine';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import type { ShellAction } from '../state/shell-action.js';

import { peerViewsOf, wheelZoomAt } from './minimap-layout.js';
import { Minimap, type MinimapPeers } from './minimap.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** An empty page. */
const BOARD = {
  board: { references: { childrenOf: () => [] }, get: () => undefined },
  subscribe: () => () => undefined,
} as unknown as BoardView;

/**
 * A collaborator's presence.
 *
 * @param id - Their principal id, and their name; their colour is their colourway's dark, from
 *   the id (the colour sent is ignored).
 * @param page - Their page, if they share one.
 * @param hasViewport - Whether they share a viewport.
 * @returns The presence.
 */
function peer(id: string, page?: string, hasViewport = true): PresenceState {
  return {
    principal: { id, kind: 'user', name: id, color: '#123456' },
    ...(hasViewport ? { viewport: { x: 100, y: 50, w: 400, h: 300, zoom: 2 } } : {}),
    ...(page === undefined ? {} : { page }),
  } as PresenceState;
}

/** Runs the pending animation frames. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const strokes: string[] = [];
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  set strokeStyle(value: string) {
    strokes.push(value);
  },
  lineWidth: 1,
};

beforeEach(() => {
  strokes.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('peerViewsOf', () => {
  it('keeps the views shared on the page shown; a client without a page is on the first', () => {
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('jonas', 'page-2')],
      [2, peer('ada')],
      [3, peer('kai', 'page-1')],
      [4, peer('ana', 'page-1', false)],
    ]);
    expect(peerViewsOf(snapshot, 'page-1', 'page-1').map((view) => view.color)).toEqual([
      colorForPrincipal('ada'),
      colorForPrincipal('kai'),
    ]);
    expect(peerViewsOf(snapshot, 'page-2', 'page-1')).toEqual([
      { x: 100, y: 50, width: 400, height: 300, color: colorForPrincipal('jonas') },
    ]);
  });
});

describe('wheelZoomAt', () => {
  it('keeps the board point under the pointer still, zooming in for a wheel up', () => {
    const zoom = wheelZoomAt({ ...CAMERA, x: 100, y: 50, zoom: 2 }, { x: 150, y: 100 }, -100);
    expect(zoom).toEqual({ centerXPx: 100, centerYPx: 100, scale: Math.E });
  });
});

describe('Minimap with collaborators', () => {
  it('strokes each collaborator’s view on the page in their colour, again when presence changes', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    let snapshot: PresenceSnapshot = new Map([[1, peer('jonas')]]);
    const listeners = new Set<() => void>();
    const peers: MinimapPeers = {
      remotePresence: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      pageOf: () => 'page-1',
    };
    const { unmount } = render(
      <Minimap themeName="light" board={BOARD} camera={camera} dispatch={vi.fn()} peers={peers} />,
    );
    await nextFrame();
    expect(strokes[0]).toBe(colorForPrincipal('jonas'));
    strokes.length = 0;
    snapshot = new Map([[2, peer('ada')]]);
    for (const listener of listeners) listener();
    await nextFrame();
    expect(strokes[0]).toBe(colorForPrincipal('ada'));
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('zooms the view by a wheel on the map, keeping the page still', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<Minimap themeName="light" board={BOARD} camera={camera} dispatch={dispatch} />);
    const map = screen.getByRole('img', { name: /^Minimap/ });
    // Before it has drawn, a wheel moves nothing, and still not the page.
    expect(fireEvent.wheel(map, { deltaY: -100 })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    await nextFrame();
    expect(fireEvent.wheel(map, { deltaY: -100, clientX: 108, clientY: 60 })).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zoomCamera', scale: Math.E }),
    );
    // A wheel in lines (Firefox's mouse wheel) turns as far as its pixels would.
    dispatch.mockClear();
    fireEvent.wheel(map, { deltaY: -1, deltaMode: 1, clientX: 108, clientY: 60 });
    const [lines] = dispatch.mock.calls.map(([action]) => action) as { scale: number }[];
    expect(lines?.scale).toBeGreaterThan(1.1);
  });
});
