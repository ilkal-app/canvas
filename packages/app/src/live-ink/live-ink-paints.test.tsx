// @vitest-environment jsdom
// The live ink overlay's paints of new input, for the ink latency readout: each paint
// that shows a new input reports it once, through the channel, to listeners that do not make the
// draw tool draw through it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { LiveInkChannel, type LiveInkPaint } from './live-ink-channel.js';
import { LiveInkOverlay } from './live-ink-overlay.js';

vi.mock('./live-ink-drawing.js', () => ({ drawLiveInk: vi.fn() }));

/** The page animation frames requested and not yet run. */
let frames: FrameRequestCallback[] = [];

/** Runs the animation frames requested so far. */
function runFrames(): void {
  const due = frames;
  frames = [];
  for (const frame of due) frame(0);
}

beforeEach(() => {
  frames = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiveInkChannel paints', () => {
  it('hands paints to their listeners, which do not attach the channel', () => {
    const channel = new LiveInkChannel();
    const paints: LiveInkPaint[] = [];
    const stop = channel.subscribePaints((paint) => paints.push(paint));
    expect(channel.isAttached()).toBe(false);
    channel.painted({ strokeId: 1, inputMs: 10, paintedMs: 26 });
    stop();
    channel.painted({ strokeId: 1, inputMs: 20, paintedMs: 36 });
    expect(paints).toEqual([{ strokeId: 1, inputMs: 10, paintedMs: 26 }]);
  });

  it('carries the input time of what it shows to the overlay', () => {
    const channel = new LiveInkChannel();
    const models: unknown[] = [];
    channel.attach((model) => models.push(model));
    channel.show([], 40);
    channel.show([]);
    expect(models).toEqual([
      { strokeId: 1, pieces: [], phase: 'drawing', inputMs: 40 },
      { strokeId: 1, pieces: [], phase: 'drawing' },
    ]);
  });
});

describe('LiveInkOverlay paints', () => {
  it('reports each new input once, when its page frame has drawn it', () => {
    const liveInk = new LiveInkChannel();
    const camera = createCameraSource();
    camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 50, dpr: 1 });
    const engine = { liveInk } as unknown as MountedEngine;
    render(<LiveInkOverlay engine={engine} camera={camera} />);
    const paints: LiveInkPaint[] = [];
    liveInk.subscribePaints((paint) => paints.push(paint));
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(116);
    act(() => {
      liveInk.show([], 100);
    });
    act(runFrames);
    expect(paints).toEqual([{ strokeId: 1, inputMs: 100, paintedMs: 116 }]);
    // A redraw for the camera shows no new input.
    act(() => {
      camera.write({ x: 5, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 50, dpr: 1 });
    });
    act(runFrames);
    expect(paints).toHaveLength(1);
    now.mockReturnValue(130);
    act(() => {
      liveInk.show([], 120);
    });
    act(runFrames);
    expect(paints.at(-1)).toEqual({ strokeId: 1, inputMs: 120, paintedMs: 130 });
  });
});
