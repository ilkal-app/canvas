import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGpuBackend } from '../../gpu/create-gpu-backend.js';

import { createBrowserHostPlatform, type BrowserHostScope } from './browser-host-platform.js';

// The real backends need a GPU; their creation is the golden scenes' business (tooling/golden).
vi.mock('../../gpu/create-gpu-backend.js', () => ({
  createGpuBackend: vi.fn(() => Promise.resolve({ capabilities: { backendName: 'webgl2' } })),
}));

/**
 * A scope with a clock at a fixed time, timers the test runs, and optional animation frames.
 *
 * @param hasFrames - Whether it has animation frames.
 * @returns The scope, with hooks to run its timers and frames.
 */
function createScope(hasFrames: boolean): BrowserHostScope & {
  runTimers(): void;
  frameCallbacks: ((timeMs: number) => void)[];
  cancelledFrames: number[];
} {
  const timers = new Map<number, () => void>();
  const frameCallbacks: ((timeMs: number) => void)[] = [];
  const cancelledFrames: number[] = [];
  let nextHandle = 1;
  const scope = {
    performance: { timeOrigin: 1_700_000_000_000, now: () => 250 },
    setTimeout: (callback: () => void) => {
      timers.set(nextHandle, callback);
      return nextHandle++;
    },
    clearTimeout: (handle: number) => {
      timers.delete(handle);
    },
    runTimers: () => {
      for (const callback of timers.values()) callback();
      timers.clear();
    },
    frameCallbacks,
    cancelledFrames,
  };
  if (!hasFrames) return scope;
  return {
    ...scope,
    requestAnimationFrame(callback: (timeMs: number) => void) {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
    cancelAnimationFrame(handle: number) {
      cancelledFrames.push(handle);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createBrowserHostPlatform', () => {
  it("uses the scope's clock origin and animation frames", () => {
    const scope = createScope(true);
    const platform = createBrowserHostPlatform(scope);
    expect(platform.timeOriginMs).toBe(1_700_000_000_000);
    expect(platform.hasAnimationFrames).toBe(true);
    const times: number[] = [];
    const handle = platform.requestAnimationFrame((timeMs) => times.push(timeMs));
    scope.frameCallbacks[0]?.(16);
    platform.cancelAnimationFrame(handle);
    expect(times).toEqual([16]);
    expect(scope.cancelledFrames).toEqual([handle]);
  });

  it('falls back to a timer stamped with performance.now() where the scope has no frames', () => {
    const scope = createScope(false);
    const platform = createBrowserHostPlatform(scope);
    expect(platform.hasAnimationFrames).toBe(false);
    const times: number[] = [];
    platform.requestAnimationFrame((timeMs) => times.push(timeMs));
    const cancelled = platform.requestAnimationFrame((timeMs) => times.push(-timeMs));
    platform.cancelAnimationFrame(cancelled);
    scope.runTimers();
    expect(times).toEqual([250]);
  });

  it('says a worker cannot render where OffscreenCanvas or workers are missing', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(createBrowserHostPlatform(createScope(true)).canRenderInWorker()).toBe(false);
  });

  it('probes an OffscreenCanvas for WebGL2, once, and never loses the probe context', () => {
    const loseContext = vi.fn();
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = getContext;
      },
    );
    vi.stubGlobal('Worker', vi.fn());
    vi.stubGlobal(
      'HTMLCanvasElement',
      class {
        transferControlToOffscreen(): void {
          // A stand-in: only its presence is probed.
        }
      },
    );
    const platform = createBrowserHostPlatform(createScope(true));
    expect(platform.canRenderInWorker()).toBe(true);
    expect(platform.canRenderInWorker()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    // Firefox reports a deliberate loss as "WebGL context was lost", a real loss's warning.
    expect(loseContext).not.toHaveBeenCalled();
  });

  it('says a worker cannot render where an OffscreenCanvas has no WebGL2', () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): null {
          return null;
        }
      },
    );
    vi.stubGlobal('Worker', vi.fn());
    vi.stubGlobal(
      'HTMLCanvasElement',
      class {
        transferControlToOffscreen(): void {
          // A stand-in: only its presence is probed.
        }
      },
    );
    expect(createBrowserHostPlatform(createScope(true)).canRenderInWorker()).toBe(false);
  });

  it('hands over only a page canvas, and draws only into a canvas', async () => {
    const offscreen = { width: 1, height: 1 };
    class FakePageCanvas {
      width = 1;
      height = 1;
      transferControlToOffscreen(): object {
        return offscreen;
      }
    }
    vi.stubGlobal('HTMLCanvasElement', FakePageCanvas);
    vi.stubGlobal('OffscreenCanvas', undefined);
    const platform = createBrowserHostPlatform(createScope(true));
    expect(platform.transferControlToOffscreen(new FakePageCanvas())).toBe(offscreen);
    expect(() => platform.transferControlToOffscreen({ width: 1, height: 1 })).toThrow(TypeError);
    await expect(
      platform.createBackend({ width: 1, height: 1 }, { prefer: 'webgl2' }),
    ).rejects.toThrow(TypeError);
  });

  it('creates the backend for an OffscreenCanvas through createGpuBackend', async () => {
    class FakeOffscreenCanvas {
      width = 1;
      height = 1;
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const platform = createBrowserHostPlatform(createScope(true));
    const canvas = new FakeOffscreenCanvas();
    await expect(platform.createBackend(canvas, { prefer: 'webgl2' })).resolves.toMatchObject({
      capabilities: { backendName: 'webgl2' },
    });
    expect(createGpuBackend).toHaveBeenCalledWith(canvas, { prefer: 'webgl2' });
  });
});
