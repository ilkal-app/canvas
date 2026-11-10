// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import {
  freehandCurve,
  type FreehandObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { LiveInkChannel, type LiveInkModel } from './live-ink-channel.js';
import type { LiveInkHandOff } from './live-ink-hand-off.js';
import { isLiveInkOff } from './live-ink-off.js';
import { LiveInkOverlay } from './live-ink-overlay.js';

const CAMERA: Camera = {
  x: 10,
  y: 20,
  zoom: 2,
  viewportWidthPx: 400,
  viewportHeightPx: 300,
  dpr: 2,
};

/**
 * A stamped world stroke with a straight cubic and optional opacity.
 *
 * @param tool - The freehand tool.
 * @param opacity - The layer opacity.
 * @returns Its world object.
 */
function piece(tool: FreehandObject['tool'] = 'pencil', opacity?: number): FreehandObject {
  return {
    id: 'ink-1' as ObjectId,
    type: 'freehand',
    parentId: null,
    x: 20,
    y: 30,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1,
    updatedAt: 1,
    tool,
    points: [0, 0, 30, 0],
    stroke: { color: [1, 0, 0, 1], width: 6 },
    ...(opacity === undefined ? {} : { opacity }),
  };
}

interface InkContext {
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly beginPath: ReturnType<typeof vi.fn>;
  readonly moveTo: ReturnType<typeof vi.fn>;
  readonly lineTo: ReturnType<typeof vi.fn>;
  readonly bezierCurveTo: ReturnType<typeof vi.fn>;
  readonly stroke: ReturnType<typeof vi.fn>;
  readonly setTransform: ReturnType<typeof vi.fn>;
  readonly compositeAlphas: number[];
  readonly strokeWidths: number[];
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  strokeStyle: string;
}

/**
 * A 2D canvas context that records drawing and compositing.
 *
 * @returns The recording context.
 */
function recordingContext(): InkContext & { drawImage: ReturnType<typeof vi.fn> } {
  const context = {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    compositeAlphas: [] as number[],
    strokeWidths: [] as number[],
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    strokeStyle: '',
  };
  context.drawImage.mockImplementation(() => context.compositeAlphas.push(context.globalAlpha));
  context.stroke.mockImplementation(() => context.strokeWidths.push(context.lineWidth));
  return context;
}

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof recordingContext>>();
const allContexts: ReturnType<typeof recordingContext>[] = [];
let frames: FrameRequestCallback[] = [];

/** Runs one page animation frame queued by the overlay. */
async function pageFrame(): Promise<void> {
  const pending = frames;
  frames = [];
  await act(async () => {
    for (const callback of pending) callback(performance.now());
    await Promise.resolve();
  });
}

/**
 * The mounted overlay and its channel.
 *
 * @param handOff - Optional controllable hand-off.
 * @returns The channel, camera, canvas and context.
 * @throws {Error} When the overlay canvas or its context is absent.
 */
function mounted(handOff?: LiveInkHandOff) {
  const liveInk = new LiveInkChannel(handOff);
  const camera = createCameraSource();
  camera.write(CAMERA);
  const engine = { liveInk } as unknown as MountedEngine;
  const view = render(<LiveInkOverlay engine={engine} camera={camera} />);
  // The overlay mounts its canvas at the first stroke and keeps it: show one and drop it.
  act(() => {
    liveInk.show([]);
  });
  act(() => {
    liveInk.clear();
  });
  const canvas = view.container.querySelector<HTMLCanvasElement>('[data-live-ink]');
  if (canvas === null) throw new Error('Live ink canvas was not mounted.');
  const context = contexts.get(canvas);
  if (context === undefined) throw new Error('Live ink has no 2D context.');
  return { liveInk, camera, canvas, context };
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  allContexts.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this);
    if (context === undefined) {
      context = recordingContext();
      contexts.set(this, context);
      allContexts.push(context);
    }
    return context as unknown as CanvasRenderingContext2D;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('page live ink', () => {
  it('numbers strokes and sends drawing, released, drawn and cleared models only for open strokes', () => {
    const channel = new LiveInkChannel();
    const first = vi.fn<(model: LiveInkModel) => void>();
    const second = vi.fn<(model: LiveInkModel) => void>();
    expect(channel.isAttached()).toBe(false);
    const detachFirst = channel.attach(first);
    const detachSecond = channel.attach(second);
    expect(channel.isAttached()).toBe(true);
    const pieces = [piece()];
    channel.show(pieces);
    channel.release();
    channel.clear();
    channel.release();
    channel.show(pieces);
    channel.clear();
    expect(first.mock.calls.map(([model]) => model)).toEqual([
      { strokeId: 1, phase: 'drawing', pieces },
      { strokeId: 1, phase: 'released', pieces },
      { strokeId: 1, phase: 'drawn', pieces: [] },
      { strokeId: 2, phase: 'drawing', pieces },
      { strokeId: 2, phase: 'cleared', pieces: [] },
    ]);
    detachFirst();
    expect(channel.isAttached()).toBe(true);
    channel.show(pieces);
    expect(first).toHaveBeenCalledTimes(5);
    expect(second).toHaveBeenCalledTimes(6);
    expect(second.mock.lastCall?.[0]).toEqual({ strokeId: 3, phase: 'drawing', pieces });
    detachSecond();
    expect(channel.isAttached()).toBe(false);
  });

  it.each(['pencil', 'highlighter'] as const)(
    'draws the %s curve in camera screen space',
    async (tool) => {
      const { liveInk, canvas, context, camera } = mounted();
      expect(canvas.getAttribute('aria-hidden')).toBe('true');
      expect(canvas.style.pointerEvents).toBe('none');
      expect([canvas.width, canvas.height]).toEqual([800, 600]);
      const stroke = piece(tool);
      act(() => {
        liveInk.show([stroke]);
      });
      await pageFrame();
      const curve = freehandCurve(stroke.points)[0];
      if (curve === undefined) throw new Error('Expected a curve.');
      const screen = (x: number, y: number) => ({
        x: (stroke.x + x - CAMERA.x) * CAMERA.zoom,
        y: (stroke.y + y - CAMERA.y) * CAMERA.zoom,
      });
      const c1 = screen(curve.c1.x, curve.c1.y);
      const c2 = screen(curve.c2.x, curve.c2.y);
      const to = screen(curve.to.x, curve.to.y);
      expect(context.bezierCurveTo).toHaveBeenCalledWith(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
      expect(context.lineWidth).toBe(12);
      expect(context.lineCap).toBe(tool === 'highlighter' ? 'butt' : 'round');
      expect(context.stroke).toHaveBeenCalled();
      camera.write({ ...CAMERA, x: 20 });
      await pageFrame();
      expect(context.bezierCurveTo).toHaveBeenCalledWith(
        c1.x - 20,
        c1.y,
        c2.x - 20,
        c2.y,
        to.x - 20,
        to.y,
      );
    },
  );

  it('tapers a marker segment from about 30% to 100% of its screen width', async () => {
    const { liveInk, context } = mounted();
    const marker = { ...piece('marker'), points: [0, 0, 40, 0], pressures: [0, 1] };
    act(() => {
      liveInk.show([marker]);
    });
    await pageFrame();
    const widths = context.strokeWidths;
    expect(widths).toHaveLength(32);
    expect(widths[0]).toBeCloseTo(12 * (0.3 + 0.7 * (0.5 / 32)));
    expect(widths.at(-1)).toBeCloseTo(12 * (0.3 + 0.7 * (31.5 / 32)));
    expect(widths.every((width, index) => index === 0 || width > (widths[index - 1] ?? 0))).toBe(
      true,
    );
    expect(context.lineTo).toHaveBeenCalledTimes(32);
  });

  it('composites a translucent piece once at its opacity', async () => {
    const { liveInk, context } = mounted();
    act(() => {
      liveInk.show([piece('highlighter', 0.4)]);
    });
    await pageFrame();
    const layer = allContexts.find(
      (candidate) => candidate !== context && candidate.stroke.mock.calls.length > 0,
    );
    expect(layer).toBeDefined();
    expect(layer?.globalAlpha).toBe(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.compositeAlphas).toEqual([0.4]);
  });

  it('keeps released ink until its hand-off reports drawn, then clears it', async () => {
    let drawn: (() => void) | undefined;
    const { liveInk, context } = mounted((callback) => {
      drawn = callback;
      return vi.fn();
    });
    act(() => {
      liveInk.show([piece()]);
    });
    await pageFrame();
    expect(context.stroke).toHaveBeenCalled();
    context.stroke.mockClear();
    act(() => {
      liveInk.release();
    });
    await pageFrame();
    expect(context.stroke).toHaveBeenCalled();
    context.clearRect.mockClear();
    context.stroke.mockClear();
    act(() => {
      drawn?.();
    });
    await pageFrame();
    expect(context.clearRect).toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it('draws a released stroke alongside the next drawing stroke, then removes only the first', async () => {
    let drawnA: (() => void) | undefined;
    const { liveInk, context } = mounted((callback) => {
      drawnA = callback;
      return vi.fn();
    });
    const strokeA = piece();
    const strokeB = { ...piece(), id: 'ink-2' as ObjectId, x: 70 };
    act(() => {
      liveInk.show([strokeA]);
    });
    await pageFrame();
    act(() => {
      liveInk.release();
      liveInk.show([strokeB]);
    });
    context.moveTo.mockClear();
    await pageFrame();
    expect(context.moveTo).toHaveBeenCalledWith(20, 20);
    expect(context.moveTo).toHaveBeenCalledWith(120, 20);
    act(() => drawnA?.());
    context.moveTo.mockClear();
    await pageFrame();
    expect(context.moveTo).not.toHaveBeenCalledWith(20, 20);
    expect(context.moveTo).toHaveBeenCalledWith(120, 20);
  });

  it('clears a dropped open stroke at once', async () => {
    const { liveInk, context } = mounted();
    act(() => {
      liveInk.show([piece()]);
    });
    await pageFrame();
    context.clearRect.mockClear();
    act(() => {
      liveInk.clear();
    });
    await pageFrame();
    expect(context.clearRect).toHaveBeenCalled();
  });

  it('does not attach or mount when no canvas has a 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const liveInk = new LiveInkChannel();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const engine = { liveInk } as unknown as MountedEngine;
    const view = render(<LiveInkOverlay engine={engine} camera={camera} />);
    expect(liveInk.isAttached()).toBe(false);
    act(() => {
      liveInk.show([piece()]);
    });
    expect(view.container.querySelector('[data-live-ink]')).toBeNull();
  });

  it('detaches when the mounted overlay canvas has no 2D context after a successful probe', () => {
    const probeContext = recordingContext();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return this.hasAttribute('data-live-ink')
          ? null
          : (probeContext as unknown as CanvasRenderingContext2D);
      });
    const liveInk = new LiveInkChannel();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const engine = { liveInk } as unknown as MountedEngine;
    const view = render(<LiveInkOverlay engine={engine} camera={camera} />);
    expect(getContext.mock.results[0]?.value).toBe(probeContext);
    expect(liveInk.isAttached()).toBe(true);

    act(() => {
      liveInk.show([piece()]);
    });
    expect(view.container.querySelector('[data-live-ink]')).not.toBeNull();
    expect(liveInk.isAttached()).toBe(false);
    expect(getContext.mock.results.some((result) => result.value === null)).toBe(true);

    act(() => {
      liveInk.clear();
      liveInk.show([piece()]);
    });
    expect(liveInk.isAttached()).toBe(false);
  });

  it('honours only the liveink=off query', () => {
    expect(isLiveInkOff('?liveink=off')).toBe(true);
    expect(isLiveInkOff('')).toBe(false);
    expect(isLiveInkOff('?liveink=on')).toBe(false);
  });
});
