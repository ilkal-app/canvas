// @vitest-environment jsdom
// What a camera move costs the minimap: the board's items are resolved once per board
// change and drawn onto a layer the map copies while its frame stays, so a move inside the board
// draws no object again; a move that changes the frame, and a document change, draw them again.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView, BoardViewChange } from '../engine/board-view.js';

import { Minimap } from './minimap.js';

/** A view of 800 × 600 at 100%, inside the section. */
const CAMERA: Camera = {
  x: 1000,
  y: 1000,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/** A section much larger than the view, so the map's frame is the section's. */
const SECTION = {
  id: 'section-1' as ObjectId,
  type: 'frame',
  parentId: null,
  x: 0,
  y: 0,
  width: 10_000,
  height: 6_000,
  rotation: 0,
} as unknown as BoardObject;

/**
 * A page of one large section, whose document changes a test reports.
 *
 * @param listeners - Where its listeners go.
 * @param reads - Counts the reads of its objects.
 * @param reads.count - The reads so far.
 * @returns The board view.
 */
function boardOf(
  listeners: Set<(change: BoardViewChange) => void>,
  reads: { count: number },
): BoardView {
  return {
    board: {
      references: {
        childrenOf: (parent: ObjectId | null) => (parent === null ? [SECTION.id] : []),
      },
      get: (id: ObjectId) => {
        reads.count += 1;
        return id === SECTION.id ? SECTION : undefined;
      },
    },
    subscribe: (listener: (change: BoardViewChange) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
  for (const mock of [context.roundRect, context.drawImage, context.fill]) mock.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Minimap board layer', () => {
  it('copies the drawn board for a camera move inside it, and draws it again only when it must', async () => {
    const listeners = new Set<(change: BoardViewChange) => void>();
    const reads = { count: 0 };
    const camera = createCameraSource();
    camera.write(CAMERA);
    render(
      <Minimap
        board={boardOf(listeners, reads)}
        camera={camera}
        dispatch={vi.fn()}
        themeName="light"
      />,
    );
    await nextFrame();
    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    const readsAfterFirst = reads.count;

    // A pan inside the section: the frame stays, so nothing is resolved or drawn again.
    camera.write({ ...CAMERA, x: 2000, y: 1500 });
    await nextFrame();
    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(reads.count).toBe(readsAfterFirst);

    // A zoom out past the section: the frame grows, so the items are drawn again, unresolved.
    camera.write({ ...CAMERA, zoom: 0.05 });
    await nextFrame();
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(reads.count).toBe(readsAfterFirst);

    // A document change resolves the items again.
    for (const listener of listeners) listener({ kind: 'document', changes: {} as never });
    await nextFrame();
    expect(context.fill).toHaveBeenCalledTimes(3);
    expect(reads.count).toBeGreaterThan(readsAfterFirst);
  });
});
