// @vitest-environment jsdom
// When the live ink overlay has a canvas: none until the first stroke, so a board drawn
// on with no pen has only the engine's canvas, and then one, kept between strokes.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { LiveInkChannel } from './live-ink-channel.js';
import { LiveInkOverlay } from './live-ink-overlay.js';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiveInkOverlay canvas', () => {
  it('listens from its mount, has a canvas from the first stroke, and keeps it', () => {
    const liveInk = new LiveInkChannel();
    const camera = createCameraSource();
    camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 50, dpr: 1 });
    const engine = { liveInk } as unknown as MountedEngine;
    const view = render(<LiveInkOverlay engine={engine} camera={camera} />);
    const canvas = () => view.container.querySelector('[data-live-ink]');
    expect(liveInk.isAttached()).toBe(true);
    expect(canvas()).toBeNull();
    act(() => {
      liveInk.show([]);
    });
    expect(canvas()).not.toBeNull();
    act(() => {
      liveInk.clear();
    });
    expect(canvas()).not.toBeNull();
    view.unmount();
    expect(liveInk.isAttached()).toBe(false);
  });
});
