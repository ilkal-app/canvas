// @vitest-environment jsdom
// When the minimap draws again, and in which colours: a token-coloured sticky in its
// resolved colour, again on a theme or token change, never for a selection alone.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import { resolveColor, type BoardObject, type ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardView, BoardViewChange } from '../engine/board-view.js';

import { Minimap } from './minimap.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** A sticky coloured by the built-in `accent` token, under the view. */
const STICKY = {
  id: 'sticky-1' as ObjectId,
  type: 'sticky',
  parentId: null,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  rotation: 0,
  color: { token: 'accent' },
} as unknown as BoardObject;

/** What the fake board's listeners are, so a test can report a change. */
interface Feeds {
  readonly board: Set<(change: BoardViewChange) => void>;
  readonly tokens: Set<() => void>;
}

/**
 * A page of one token-coloured sticky.
 *
 * @param feeds - Where its listeners go.
 * @returns The board view.
 */
function boardOf(feeds: Feeds): BoardView {
  const add =
    <T,>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  return {
    board: {
      references: { childrenOf: (parent: ObjectId | null) => (parent === null ? [STICKY.id] : []) },
      get: (id: ObjectId) => (id === STICKY.id ? STICKY : undefined),
    },
    tokens: () => new Map(),
    subscribe: add(feeds.board),
    subscribeTokens: add(feeds.tokens),
  } as unknown as BoardView;
}

/** Runs the pending animation frames. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const fills: string[] = [];
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  set fillStyle(value: string) {
    fills.push(value);
  },
  strokeStyle: '',
  lineWidth: 1,
};

beforeEach(() => {
  fills.length = 0;
  context.clearRect.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Minimap redraws', () => {
  it('draws a token-coloured sticky in its colour for the theme, again when the theme changes', async () => {
    const feeds: Feeds = { board: new Set(), tokens: new Set() };
    const board = boardOf(feeds);
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { rerender } = render(
      <Minimap board={board} camera={camera} dispatch={vi.fn()} themeName="light" />,
    );
    await nextFrame();
    const rgba = (mode: 'light' | 'dark') => {
      const [r, g, b, a] = resolveColor({ token: 'accent' }, mode);
      return `rgba(${String(r * 255)}, ${String(g * 255)}, ${String(b * 255)}, ${String(a)})`;
    };
    expect(fills).toEqual([rgba('light')]);
    rerender(<Minimap board={board} camera={camera} dispatch={vi.fn()} themeName="dark" />);
    await nextFrame();
    expect(fills).toEqual([rgba('light'), rgba('dark')]);
  });

  it('draws again for a document or token change, never for a selection alone', async () => {
    const feeds: Feeds = { board: new Set(), tokens: new Set() };
    const camera = createCameraSource();
    camera.write(CAMERA);
    render(<Minimap board={boardOf(feeds)} camera={camera} dispatch={vi.fn()} themeName="light" />);
    await nextFrame();
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    for (const listener of feeds.board) listener({ kind: 'selection' });
    await nextFrame();
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    for (const listener of feeds.board) {
      listener({ kind: 'document', changes: {} as never });
    }
    await nextFrame();
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    for (const listener of feeds.tokens) listener();
    await nextFrame();
    expect(context.clearRect).toHaveBeenCalledTimes(3);
  });
});
