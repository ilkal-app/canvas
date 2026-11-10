// A GpuBackend stand-in that records the calls a renderer makes, for GPU-free unit tests of
// draw sequencing. Real rendering is tested on a real GPU by the golden scenes (tooling/golden).
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupDescriptor } from '../../gpu/gpu-bind-group.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../../gpu/gpu-buffer.js';
import type { GpuRenderPipeline, GpuRenderPipelineDescriptor } from '../../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../../gpu/gpu-render-pass.js';
import type { GpuTexture, GpuTextureDescriptor } from '../../gpu/gpu-texture.js';

/** One recorded call: its name and arguments. */
export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A recording backend and pass, sharing one call log. */
export interface RecordingGpu {
  readonly backend: GpuBackend;
  readonly pass: GpuRenderPass;
  readonly calls: RecordedCall[];
}

function unsupported(name: string): never {
  throw new Error(`The recording backend does not support ${name}.`);
}

/**
 * A texture as a plain record, logging its creation and destruction.
 *
 * @param descriptor - The texture's description.
 * @param record - The call log.
 * @returns The texture.
 */
function recordingTexture(
  descriptor: GpuTextureDescriptor,
  record: (name: string, ...args: unknown[]) => void,
): GpuTexture {
  const texture: GpuTexture = {
    format: descriptor.format,
    width: descriptor.width,
    height: descriptor.height,
    destroy: () => {
      record('destroyTexture', texture);
    },
  };
  record('createTexture', descriptor);
  return texture;
}

/**
 * Creates a backend whose buffers and pipelines are plain records and whose pass logs its
 * commands.
 *
 * @returns The backend, a pass on it and the shared call log.
 */
export function createRecordingGpu(): RecordingGpu {
  const calls: RecordedCall[] = [];
  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args });
  };
  const backend: GpuBackend = {
    capabilities: {
      backendName: 'webgl2',
      maxTextureSize: 4096,
      hasTimestampQuery: false,
      sampleCount: 1,
      adapterName: 'recording',
      isSoftwareAdapter: false,
    },
    createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
      const buffer: GpuBuffer = {
        usage: descriptor.usage,
        byteLength: descriptor.byteLength,
        destroy: () => {
          record('destroyBuffer', buffer);
        },
      };
      record('createBuffer', descriptor);
      return buffer;
    },
    writeBuffer: (buffer, byteOffset, data) => {
      record('writeBuffer', buffer, byteOffset, Array.from(new Float32Array(data.buffer)));
    },
    createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
      const pipeline: GpuRenderPipeline = {
        bindings: descriptor.bindings,
        destroy: () => {
          record('destroyPipeline', pipeline);
        },
      };
      record('createRenderPipeline', descriptor);
      return pipeline;
    },
    createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup {
      record('createBindGroup', descriptor);
      return { entries: descriptor.entries };
    },
    createTexture: (descriptor) => recordingTexture(descriptor, record),
    writeTexture: () => unsupported('writeTexture'),
    createSampler: () => unsupported('createSampler'),
    createRenderTarget: () => unsupported('createRenderTarget'),
    beginRenderPass: () => unsupported('beginRenderPass'),
    submit: () => unsupported('submit'),
    readPixels: () => unsupported('readPixels'),
    collectPassTimings: () => unsupported('collectPassTimings'),
    onDeviceLost: () => () => undefined,
    destroy: () => unsupported('destroy'),
  };
  const pass: GpuRenderPass = {
    setViewport: (viewport) => {
      record('setViewport', viewport);
    },
    setPipeline: (pipeline) => {
      record('setPipeline', pipeline);
    },
    setBindGroup: (bindGroup) => {
      record('setBindGroup', bindGroup);
    },
    setVertexBuffer: (slot, buffer, byteOffset) => {
      record('setVertexBuffer', slot, buffer, byteOffset);
    },
    draw: (vertexCount, instanceCount, firstVertex, firstInstance) => {
      record('draw', vertexCount, instanceCount, firstVertex, firstInstance);
    },
    end: () => {
      record('end');
    },
  };
  return { backend, pass, calls };
}
