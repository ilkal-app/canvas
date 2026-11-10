// @vitest-environment jsdom
// Real layout resizes and device pixel ratio changes in a browser:
// tooling/scenario/specs/app/canvas-mount*.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasBackingSize } from './backing-store-size.js';
import { CanvasMount } from './canvas-mount.js';

type ResizeCallback = (entries: Partial<ResizeObserverEntry>[]) => void;

/** Replaces ResizeObserver with one whose callback the test fires by hand. */
class FakeResizeObserver {
  static latest: FakeResizeObserver | undefined;
  readonly callback: ResizeCallback;
  readonly observedBoxes: (string | undefined)[] = [];
  isDisconnected = false;

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    FakeResizeObserver.latest = this;
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    expect(target).toBeInstanceOf(HTMLCanvasElement);
    this.observedBoxes.push(options?.box);
  }

  disconnect(): void {
    this.isDisconnected = true;
  }

  resize(cssWidth: number, cssHeight: number, devicePixels?: [number, number]): void {
    const contentRect = { width: cssWidth, height: cssHeight } as DOMRectReadOnly;
    const devicePixelContentBoxSize =
      devicePixels === undefined
        ? undefined
        : [{ inlineSize: devicePixels[0], blockSize: devicePixels[1] }];
    act(() => {
      this.callback([{ contentRect, devicePixelContentBoxSize } as Partial<ResizeObserverEntry>]);
    });
  }
}

beforeEach(() => {
  // Fixed device pixel ratio for determinism.
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  FakeResizeObserver.latest = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function canvasElement(): HTMLCanvasElement {
  const canvas = screen.getByRole('main', { name: 'Canvas' }).querySelector('canvas');
  if (canvas === null) throw new Error('CanvasMount rendered no canvas');
  return canvas;
}

describe('CanvasMount', () => {
  it('renders a canvas inside the main region labelled Canvas', () => {
    render(<CanvasMount />);
    expect(canvasElement()).toBeInstanceOf(HTMLCanvasElement);
  });

  it('hands the canvas to onCanvasReady once and runs its cleanup on unmount', () => {
    const release = vi.fn();
    const onCanvasReady = vi.fn(() => release);
    const { unmount } = render(<CanvasMount onCanvasReady={onCanvasReady} />);
    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onCanvasReady).toHaveBeenCalledWith(canvasElement());
    expect(release).not.toHaveBeenCalled();
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('sizes the drawing buffer to the CSS size times the device pixel ratio', () => {
    const sizes: CanvasBackingSize[] = [];
    render(<CanvasMount onCanvasResize={(size) => sizes.push(size)} />);
    FakeResizeObserver.latest?.resize(300, 150);
    expect(canvasElement().width).toBe(600);
    expect(canvasElement().height).toBe(300);
    expect(sizes.at(-1)).toEqual({
      cssWidthPx: 300,
      cssHeightPx: 150,
      widthPx: 600,
      heightPx: 300,
      dpr: 2,
    });
  });

  it('uses the exact device-pixel size when the browser reports it', () => {
    render(<CanvasMount />);
    FakeResizeObserver.latest?.resize(100.5, 50.25, [201, 100]);
    expect(canvasElement().width).toBe(201);
    expect(canvasElement().height).toBe(100);
  });

  it('observes the device-pixel content box', () => {
    render(<CanvasMount />);
    expect(FakeResizeObserver.latest?.observedBoxes).toEqual(['device-pixel-content-box']);
  });

  it('reports a size only when it changes', () => {
    const onCanvasResize = vi.fn();
    render(<CanvasMount onCanvasResize={onCanvasResize} />);
    const initialCalls = onCanvasResize.mock.calls.length;
    FakeResizeObserver.latest?.resize(300, 150);
    FakeResizeObserver.latest?.resize(300, 150);
    expect(onCanvasResize).toHaveBeenCalledTimes(initialCalls + 1);
  });

  it('stops observing when unmounted', () => {
    const { unmount } = render(<CanvasMount />);
    unmount();
    expect(FakeResizeObserver.latest?.isDisconnected).toBe(true);
  });

  it('still sizes the canvas once where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<CanvasMount />);
    // jsdom lays nothing out, so the size is the 1 × 1 minimum.
    expect(canvasElement().width).toBe(1);
    expect(canvasElement().height).toBe(1);
  });

  it('leaves a canvas handed over to a worker at its size but still reports each new size', () => {
    const sizes: CanvasBackingSize[] = [];
    render(<CanvasMount onCanvasResize={(size) => sizes.push(size)} />);
    // A canvas whose control went to an OffscreenCanvas refuses a new size, as Chrome's does.
    Object.defineProperty(canvasElement(), 'width', {
      get: () => 1,
      set: () => {
        throw new DOMException(
          'Cannot resize canvas after transferControlToOffscreen()',
          'InvalidStateError',
        );
      },
    });
    FakeResizeObserver.latest?.resize(300, 150);
    expect(canvasElement().width).toBe(1);
    expect(sizes.at(-1)).toMatchObject({ widthPx: 600, heightPx: 300 });
  });

  it('lets any other failure to size the canvas through', () => {
    render(<CanvasMount />);
    Object.defineProperty(canvasElement(), 'height', {
      get: () => 1,
      set: () => {
        throw new RangeError('too large');
      },
    });
    expect(() => FakeResizeObserver.latest?.resize(300, 150)).toThrow('too large');
  });
});
