import { afterEach, expect, it, vi } from 'vitest';

import type { GpuCapabilities } from './gpu-capabilities.js';
import { WebGl2Backend } from './webgl2/webgl2-backend.js';
import { WebGpuBackend } from './webgpu/webgpu-backend.js';
import type { WebGpuCanvasTarget } from './webgpu/webgpu-canvas-target.js';
import type { WebGpuPassTimer } from './webgpu/webgpu-pass-timer.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('WebGPU awaits the device queue submitted-work promise', async () => {
  let finish: (() => void) | undefined;
  const onSubmittedWorkDone = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const device = {
    queue: { onSubmittedWorkDone },
    lost: new Promise<GPUDeviceLostInfo>(() => undefined),
  } as unknown as GPUDevice;
  const target = { colorFormat: 'rgba8unorm', sampleCount: 1 } as WebGpuCanvasTarget;
  const backend = new WebGpuBackend(device, target, {} as WebGpuPassTimer, {} as GpuCapabilities);
  let isComplete = false;
  const completion = backend.whenSubmittedWorkDone?.().then(() => {
    isComplete = true;
  });
  expect(onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(isComplete).toBe(false);
  finish?.();
  await completion;
  expect(isComplete).toBe(true);
});

it('WebGL2 polls a fence until signaled and deletes it', async () => {
  vi.useFakeTimers();
  const sync = {} as WebGLSync;
  const fenceSync = vi.fn(() => sync);
  const deleteSync = vi.fn();
  const getSyncParameter = vi.fn().mockReturnValueOnce('UNSIGNALED').mockReturnValue('SIGNALED');
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const known: Record<string, unknown> = {
    canvas,
    RENDERER: 'RENDERER',
    MAX_TEXTURE_SIZE: 'MAX_TEXTURE_SIZE',
    SAMPLES: 'SAMPLES',
    SYNC_GPU_COMMANDS_COMPLETE: 'SYNC_GPU_COMMANDS_COMPLETE',
    SYNC_STATUS: 'SYNC_STATUS',
    SIGNALED: 'SIGNALED',
    UNPACK_ALIGNMENT: 'UNPACK_ALIGNMENT',
    PACK_ALIGNMENT: 'PACK_ALIGNMENT',
    getExtension: () => null,
    getParameter: (name: string) =>
      name === 'MAX_TEXTURE_SIZE' ? 4096 : name === 'SAMPLES' ? 1 : 'fake',
    fenceSync,
    getSyncParameter,
    deleteSync,
  };
  const gl = new Proxy(known, {
    get: (target, property: string) => target[property] ?? (() => undefined),
  }) as unknown as WebGL2RenderingContext;
  const backend = new WebGl2Backend(gl);
  const completed = backend.whenSubmittedWorkDone?.();
  expect(fenceSync).toHaveBeenCalledWith('SYNC_GPU_COMMANDS_COMPLETE', 0);
  expect(getSyncParameter).toHaveBeenCalledWith(sync, 'SYNC_STATUS');
  expect(deleteSync).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  await completed;
  expect(getSyncParameter).toHaveBeenCalledTimes(2);
  expect(deleteSync).toHaveBeenCalledWith(sync);
});
