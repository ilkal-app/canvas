import { describe, expect, it } from 'vitest';

import { WebGpuPipeline } from './webgpu-pipeline.js';
import { WebGpuRenderPass } from './webgpu-render-pass.js';
import { WebGpuBindGroup, WebGpuBuffer } from './webgpu-resources.js';

// The pass encoder hears only state that changes. A zoomed-out 50k frame makes about
// 2,600 draws, and every redundant native call (and handle check) costs worker time. The pixels
// are the golden scenes' (tooling/golden), on real GPUs.

/**
 * A pass encoder that records every call by name and first argument.
 *
 * @returns The encoder and its calls.
 */
function recordingEncoder() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(
        [name, ...args.map((arg) => (typeof arg === 'number' ? String(arg) : 'handle'))].join(' '),
      );
    };
  const encoder = {
    setViewport: record('setViewport'),
    setPipeline: record('setPipeline'),
    setStencilReference: record('setStencilReference'),
    setBindGroup: record('setBindGroup'),
    setVertexBuffer: record('setVertexBuffer'),
    draw: record('draw'),
    end: record('end'),
  } as unknown as GPURenderPassEncoder;
  return { encoder, calls };
}

const DEVICE = {} as GPUDevice;
const OTHER_DEVICE = {} as GPUDevice;

/**
 * A pipeline of a device.
 *
 * @param device - Its device.
 * @returns The pipeline.
 */
function pipelineOf(device: GPUDevice = DEVICE): WebGpuPipeline {
  // The constructor compiles; the pass reads only the device and the handle.
  return Object.assign(Object.create(WebGpuPipeline.prototype) as WebGpuPipeline, {
    device,
    handle: {} as GPURenderPipeline,
  });
}

/**
 * A vertex buffer of a device.
 *
 * @param device - Its device.
 * @returns The buffer.
 */
function bufferOf(device: GPUDevice = DEVICE): WebGpuBuffer {
  return new WebGpuBuffer(device, { size: 64 } as GPUBuffer, 'vertex');
}

/**
 * A bind group of a device.
 *
 * @param device - Its device.
 * @returns The bind group.
 */
function bindGroupOf(device: GPUDevice = DEVICE): WebGpuBindGroup {
  return new WebGpuBindGroup(device, {} as GPUBindGroup, []);
}

describe('WebGpuRenderPass', () => {
  it('passes on only state that changes, then every draw', () => {
    const { encoder, calls } = recordingEncoder();
    const pass = new WebGpuRenderPass(DEVICE, encoder, () => undefined);
    const [pipeline, other] = [pipelineOf(), pipelineOf()];
    const [quad, instances] = [bufferOf(), bufferOf()];
    const group = bindGroupOf();

    for (let entry = 0; entry < 3; entry += 1) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(group);
      pass.setVertexBuffer(0, quad);
      pass.setVertexBuffer(1, instances);
      pass.draw(6, 2, 0, entry);
    }
    pass.setPipeline(other);
    pass.setVertexBuffer(1, instances, 32);
    pass.setVertexBuffer(0, instances);
    pass.draw(6);

    expect(calls).toEqual([
      'setPipeline handle',
      'setBindGroup 0 handle',
      'setVertexBuffer 0 handle 0',
      'setVertexBuffer 1 handle 0',
      'draw 6 2 0 0',
      'draw 6 2 0 1',
      'draw 6 2 0 2',
      'setPipeline handle',
      'setVertexBuffer 1 handle 32',
      'setVertexBuffer 0 handle 0',
      'draw 6 1 0 0',
    ]);
  });

  it('leaves the stencil reference at the pass default, 0', () => {
    const { encoder, calls } = recordingEncoder();
    const pass = new WebGpuRenderPass(DEVICE, encoder, () => undefined);
    pass.setPipeline(pipelineOf());
    pass.setPipeline(pipelineOf());
    expect(calls.filter((call) => call.startsWith('setStencilReference'))).toEqual([]);
  });

  it('refuses another backend’s handles, and handles of the wrong kind', () => {
    const { encoder } = recordingEncoder();
    const pass = new WebGpuRenderPass(DEVICE, encoder, () => undefined);
    expect(() => {
      pass.setPipeline(pipelineOf(OTHER_DEVICE));
    }).toThrow(TypeError);
    expect(() => {
      pass.setBindGroup(bindGroupOf(OTHER_DEVICE));
    }).toThrow(TypeError);
    expect(() => {
      pass.setVertexBuffer(0, bufferOf(OTHER_DEVICE));
    }).toThrow(TypeError);
    expect(() => {
      pass.setVertexBuffer(0, pipelineOf() as unknown as WebGpuBuffer);
    }).toThrow(TypeError);
  });
});
