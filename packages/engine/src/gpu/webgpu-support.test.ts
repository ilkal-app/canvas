import { describe, expect, it } from 'vitest';

import { isWebGpuSupported } from './webgpu-support.js';

describe('isWebGpuSupported', () => {
  it('reports WebGPU when the navigator exposes gpu', () => {
    const navigatorWithGpu = { gpu: {} } as unknown as Navigator;
    expect(isWebGpuSupported(navigatorWithGpu)).toBe(true);
  });

  it('reports no WebGPU when the navigator lacks gpu, so the engine falls back to WebGL2', () => {
    const navigatorWithoutGpu = {} as Navigator;
    expect(isWebGpuSupported(navigatorWithoutGpu)).toBe(false);
  });
});
