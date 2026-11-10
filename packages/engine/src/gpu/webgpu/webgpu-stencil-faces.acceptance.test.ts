import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GpuRenderPipelineDescriptor, GpuStencilOperation } from '../gpu-pipeline.js';

import { WebGpuPipeline } from './webgpu-pipeline.js';

// The API records winding separately; the cover still tests non-zero and clears it.
const OPERATIONS = [
  'keep',
  'zero',
  'invert',
  'increment-wrap',
  'decrement-wrap',
] as const satisfies readonly GpuStencilOperation[];
const FACE_PAIRS = OPERATIONS.map((operation, index) => ({
  operation,
  front: OPERATIONS[(index + 1) % OPERATIONS.length] ?? 'keep',
}));

const SHADER = {
  label: 'stencil faces',
  wgsl: '',
  vertexEntryPoint: 'vs',
  fragmentEntryPoint: 'fs',
  glslVertex: '',
  glslFragment: '',
};

function recordedPipeline(
  stencil: GpuRenderPipelineDescriptor['stencil'],
  colorWrite: 'all' | 'none' = 'none',
) {
  const descriptors: GPURenderPipelineDescriptor[] = [];
  const device = {
    createBindGroupLayout: () => ({}) as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as GPUPipelineLayout,
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      descriptors.push(descriptor);
      return {} as GPURenderPipeline;
    },
  } as unknown as GPUDevice;
  new WebGpuPipeline(
    device,
    {} as GPUShaderModule,
    {
      shader: SHADER,
      vertexBuffers: [],
      bindings: [],
      blend: 'none',
      colorWrite,
      ...(stencil === undefined ? {} : { stencil }),
    },
    { colorFormat: 'rgba8unorm', sampleCount: 1 },
  );
  const descriptor = descriptors[0];
  expect(descriptor).toBeDefined();
  return descriptor;
}

describe('WebGPU stencil faces', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUColorWrite', { ALL: 0xf });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(OPERATIONS)('maps %s on the front face', (operation) => {
    const descriptor = recordedPipeline({ compare: 'always', passOperation: operation });
    expect(descriptor?.depthStencil?.stencilFront).toEqual({
      compare: 'always',
      passOp: operation,
      failOp: 'keep',
      depthFailOp: 'keep',
    });
    expect(descriptor?.depthStencil?.stencilBack?.passOp).toBe(operation);
    expect(descriptor?.primitive?.cullMode).toBe('none');
  });

  it.each(FACE_PAIRS)('maps $operation on the back face independently', ({ operation, front }) => {
    const descriptor = recordedPipeline({
      compare: 'always',
      passOperation: front,
      backPassOperation: operation,
    });
    expect(descriptor?.depthStencil?.stencilFront?.passOp).toBe(front);
    expect(descriptor?.depthStencil?.stencilBack).toEqual({
      compare: 'always',
      passOp: operation,
      failOp: 'keep',
      depthFailOp: 'keep',
    });
    expect(descriptor?.primitive?.cullMode).toBe('none');
  });

  it('uses opposite wrapping operations for a non-zero fan and the unchanged clearing cover', () => {
    const fan = recordedPipeline({
      compare: 'always',
      passOperation: 'increment-wrap',
      backPassOperation: 'decrement-wrap',
    });
    expect(Array.from(fan?.fragment?.targets ?? [])[0]?.writeMask).toBe(0);
    expect(fan?.depthStencil).toMatchObject({
      stencilFront: { compare: 'always', passOp: 'increment-wrap' },
      stencilBack: { compare: 'always', passOp: 'decrement-wrap' },
    });
    expect(fan?.primitive?.cullMode).toBe('none');

    const cover = recordedPipeline({ compare: 'not-equal', passOperation: 'zero' }, 'all');
    expect(Array.from(cover?.fragment?.targets ?? [])[0]?.writeMask).toBe(0xf);
    expect(cover?.depthStencil).toMatchObject({
      stencilFront: { compare: 'not-equal', passOp: 'zero' },
      stencilBack: { compare: 'not-equal', passOp: 'zero' },
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff,
    });
  });

  it('preserves even-odd invert fans and not-equal zero covers on both faces', () => {
    for (const stencil of [
      { compare: 'always', passOperation: 'invert' },
      { compare: 'not-equal', passOperation: 'zero' },
    ] as const) {
      const descriptor = recordedPipeline(stencil);
      expect(descriptor?.depthStencil?.stencilFront).toEqual({
        compare: stencil.compare,
        passOp: stencil.passOperation,
        failOp: 'keep',
        depthFailOp: 'keep',
      });
      expect(descriptor?.depthStencil?.stencilBack).toEqual(descriptor?.depthStencil?.stencilFront);
      expect(descriptor?.primitive?.cullMode).toBe('none');
    }
  });
});
