import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GpuRenderPipelineDescriptor } from '../gpu-pipeline.js';

import { WebGpuPipeline } from './webgpu-pipeline.js';
import { WebGpuRenderPass } from './webgpu-render-pass.js';

const SHADER = {
  label: 'stencil reference',
  wgsl: '',
  vertexEntryPoint: 'vs',
  fragmentEntryPoint: 'fs',
  glslVertex: '',
  glslFragment: '',
};

function fixture(stencil: NonNullable<GpuRenderPipelineDescriptor['stencil']>) {
  let descriptor: GPURenderPipelineDescriptor | undefined;
  const device = {
    createBindGroupLayout: () => ({}) as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as GPUPipelineLayout,
    createRenderPipeline: (value: GPURenderPipelineDescriptor) => {
      descriptor = value;
      return {} as GPURenderPipeline;
    },
  } as unknown as GPUDevice;
  const pipeline = new WebGpuPipeline(
    device,
    {} as GPUShaderModule,
    {
      shader: SHADER,
      vertexBuffers: [],
      bindings: [],
      blend: 'none',
      stencil,
    },
    { colorFormat: 'rgba8unorm', sampleCount: 1 },
  );
  return { device, pipeline, descriptor: () => descriptor };
}

describe('WebGPU stencil reference and masks', () => {
  beforeEach(() => vi.stubGlobal('GPUColorWrite', { ALL: 0xf }));
  afterEach(() => vi.unstubAllGlobals());

  it('maps explicit read and write masks into the pipeline descriptor', () => {
    const { descriptor } = fixture({
      compare: 'not-equal',
      passOperation: 'replace' as never,
      reference: 0x80,
      readMask: 0x80,
      writeMask: 0x7f,
    } as never);
    expect(descriptor()?.depthStencil).toMatchObject({
      stencilReadMask: 0x80,
      stencilWriteMask: 0x7f,
    });
    expect(descriptor()?.depthStencil?.stencilFront?.passOp).toBe('replace');
  });

  it('keeps 0xff masks for existing pipelines', () => {
    const { descriptor } = fixture({ compare: 'always', passOperation: 'increment-wrap' });
    expect(descriptor()?.depthStencil).toMatchObject({
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff,
    });
  });

  it('sets each pipeline reference when bound, including a reset to zero', () => {
    const calls: number[] = [];
    const encoder = {
      setPipeline: () => undefined,
      setStencilReference: (value: number) => calls.push(value),
    } as unknown as GPURenderPassEncoder;
    const first = fixture({
      compare: 'not-equal',
      passOperation: 'zero',
      reference: 0x80,
    } as never);
    const second = fixture({ compare: 'not-equal', passOperation: 'zero' });
    // Both fixture pipelines share the device identity for the pass's ownership check.
    Object.assign(second.pipeline, { device: first.device });
    const pass = new WebGpuRenderPass(first.device, encoder, () => undefined);
    pass.setPipeline(first.pipeline);
    pass.setPipeline(second.pipeline);
    expect(calls).toEqual([0x80, 0]);
  });
});
