// @vitest-environment jsdom
// The minimap: it draws the page and the view, and a press or drag pans the camera.
// In Chrome: tooling/scenario/specs/app/floating-zoom.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import type { ShellAction } from '../state/shell-action.js';

import { Minimap } from './minimap.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * A page of one 800 × 600 object under the view.
 *
 * @param type - The object's type; a rectangle shape if absent.
 * @returns The board view.
 */
function boardOf(type = 'shape'): BoardView {
  const shape = {
    id: 'shape-1' as ObjectId,
    type,
    shape: 'rectangle',
    parentId: null,
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    rotation: 0,
  } as unknown as BoardObject;
  return {
    board: {
      references: { childrenOf: () => [shape.id] },
      get: (id: ObjectId) => (id === shape.id ? shape : undefined),
    },
    subscribe: () => () => undefined,
  } as unknown as BoardView;
}

/** Runs the pending animation frames. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Minimap', () => {
  it('draws the page’s objects and the view, and pans to where it is pressed or dragged', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<Minimap themeName="light" board={boardOf()} camera={camera} dispatch={dispatch} />);
    await nextFrame();
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
    const map = screen.getByRole('img', { name: /^Minimap/ });
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 216, clientY: 120 });
    const pans = dispatch.mock.calls.map(([action]) => action);
    expect(pans).toHaveLength(2);
    for (const pan of pans) expect(pan.type).toBe('panCamera');
    const [first, second] = pans as { deltaXPx: number; deltaYPx: number }[];
    // The top-left corner pans the view up and left (the board moves right and down); the
    // bottom-right corner the other way.
    expect(first?.deltaXPx).toBeGreaterThan(0);
    expect(first?.deltaYPx).toBeGreaterThan(0);
    expect(second?.deltaXPx).toBeLessThan(0);
    expect(second?.deltaYPx).toBeLessThan(0);
  });

  it('fills a section and what lies on it, and draws nothing without a 2D context', async () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    context.fill.mockClear();
    context.stroke.mockClear();
    const { unmount } = render(
      <Minimap themeName="light" board={boardOf('frame')} camera={camera} dispatch={vi.fn()} />,
    );
    await nextFrame();
    // The section, its child (the fixture's one object again) and, stroked, the view.
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    unmount();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    context.stroke.mockClear();
    render(<Minimap themeName="light" board={boardOf()} camera={camera} dispatch={vi.fn()} />);
    await nextFrame();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it('does not pan before it has drawn, or without a held pointer', () => {
    const camera = createCameraSource();
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<Minimap themeName="light" board={boardOf()} camera={camera} dispatch={dispatch} />);
    const map = screen.getByRole('img', { name: /^Minimap/ });
    fireEvent.pointerDown(map, { pointerId: 1 });
    HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
    fireEvent.pointerMove(map, { pointerId: 1 });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
