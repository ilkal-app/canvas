// CONTRACT: the rendered map omits peers on another page and peers without a
// viewport; a wheel over its canvas zooms around the pointed board position in both directions.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { colorForPrincipal, type PresenceSnapshot, type PresenceState } from '@canvas/collab';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import type { ShellAction } from '../state/shell-action.js';

import { Minimap, type MinimapPeers } from './minimap.js';

const BOARD = {
  board: { references: { childrenOf: () => [] }, get: () => undefined },
  subscribe: () => () => undefined,
} as unknown as BoardView;
const CAMERA = { x: -40, y: 75, zoom: 0.37, viewportWidthPx: 900, viewportHeightPx: 600, dpr: 1 };
const strokes: string[] = [];
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  lineWidth: 1,
  set strokeStyle(value: string) {
    strokes.push(value);
  },
};

// Each peer's colour is their colourway's dark, from their id; the colour sent is ignored.
function peer(id: string, page: string, hasViewport: boolean): PresenceState {
  return {
    principal: { id, kind: 'user', name: id, color: '#123456' },
    page,
    ...(hasViewport ? { viewport: { x: 3, y: 4, w: 50, h: 60, zoom: 2 } } : {}),
  } as PresenceState;
}

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

describe('rendered minimap acceptance', () => {
  it('draws only the peer with a viewport on the shown page', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('jonas', 'other', true)],
      [2, peer('ada', 'shown', false)],
      [3, peer('kai', 'shown', true)],
    ]);
    const peers: MinimapPeers = {
      remotePresence: () => snapshot,
      subscribe: () => () => undefined,
      pageOf: () => 'shown',
    };
    render(
      <Minimap board={BOARD} camera={camera} themeName="light" dispatch={vi.fn()} peers={peers} />,
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(strokes).toContain(colorForPrincipal('kai'));
    expect(strokes).not.toContain(colorForPrincipal('jonas'));
    expect(strokes).not.toContain(colorForPrincipal('ada'));
  });

  it('dispatches opposite zoom directions for wheel down and up about the pointer', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<Minimap board={BOARD} camera={camera} themeName="light" dispatch={dispatch} />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const map = screen.getByRole('img', { name: /^Minimap/ });
    expect(fireEvent.wheel(map, { deltaY: 120, clientX: 70, clientY: 45 })).toBe(false);
    expect(fireEvent.wheel(map, { deltaY: -120, clientX: 120, clientY: 80 })).toBe(false);
    const [down, up] = dispatch.mock.calls.map(([action]) => action);
    expect(down).toMatchObject({ type: 'zoomCamera' });
    expect(up).toMatchObject({ type: 'zoomCamera' });
    if (down?.type !== 'zoomCamera' || up?.type !== 'zoomCamera')
      throw new Error('Expected zoom actions');
    expect(down.scale).toBeLessThan(1);
    expect(up.scale).toBeGreaterThan(1);
    expect(up.centerXPx).toBeGreaterThan(down.centerXPx);
    expect(up.centerYPx).toBeGreaterThan(down.centerYPx);
  });
});
