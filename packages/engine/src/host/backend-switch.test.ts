import { describe, expect, it, vi } from 'vitest';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { switchingBackendFactory } from './backend-switch.js';

const LOSS = { message: 'lost', restored: Promise.resolve() };

describe('switchingBackendFactory', () => {
  it('rebuilds a lost WebGL2 context on its canvas, without asking for a fresh one', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas();
    const fallbackCanvas = vi.fn(() => new FakeCanvas());
    const onBackend = vi.fn();
    const recreate = switchingBackendFactory(
      platform,
      canvas,
      { prefer: 'webgl2' },
      fallbackCanvas,
      onBackend,
    );
    const { backend, canvas: fresh } = await recreate(LOSS, 'webgl2');
    expect(fresh).toBeUndefined();
    expect(fallbackCanvas).not.toHaveBeenCalled();
    expect(platform.backendOptions).toEqual([{ prefer: 'webgl2' }]);
    expect(onBackend).toHaveBeenCalledWith(backend, false);
  });

  it('goes on with WebGL2 on a fresh canvas at the old size after a WebGPU loss', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(8, 6);
    const fallback = new FakeCanvas(1, 1);
    const onBackend = vi.fn();
    const recreate = switchingBackendFactory(
      platform,
      canvas,
      { prefer: 'webgpu', sampleCount: 4 },
      () => Promise.resolve(fallback),
      onBackend,
    );
    const switched = await recreate(LOSS, 'webgpu');
    expect(switched.canvas).toBe(fallback);
    expect([fallback.width, fallback.height]).toEqual([8, 6]);
    expect(platform.backendOptions).toEqual([{ prefer: 'webgl2', sampleCount: 4 }]);
    expect(onBackend).toHaveBeenCalledWith(switched.backend, true);

    // A later WebGL2 loss is restored on the fallback, the canvas the engine now draws on.
    fallback.width = 3;
    const restored = await recreate(LOSS, 'webgl2');
    expect(restored.canvas).toBeUndefined();
    expect(platform.backendOptions.at(-1)).toEqual({ prefer: 'webgl2', sampleCount: 4 });
  });

  it('asks for WebGPU on its own canvas again when no fresh canvas can be had', async () => {
    const platform = new FakeHostPlatform();
    const onBackend = vi.fn();
    const recreate = switchingBackendFactory(
      platform,
      new FakeCanvas(),
      { prefer: 'webgpu' },
      () => undefined,
      onBackend,
    );
    const { canvas } = await recreate(LOSS, 'webgpu');
    expect(canvas).toBeUndefined();
    expect(platform.backendOptions).toEqual([{ prefer: 'webgpu' }]);
    expect(onBackend.mock.calls[0]?.[1]).toBe(false);
  });
});
