// A GpuBackend that draws nothing and records the render passes and draws asked of it, for the
// selection overlay's unit tests; the real overlay is judged on a GPU by the golden scenes
// `selection-overlay` and `selection-overlay-zoomed` (tooling/golden).
import type {
  GpuBackend,
  GpuBindGroup,
  GpuBuffer,
  GpuBufferDescriptor,
  GpuCapabilities,
  GpuRenderPass,
  GpuRenderPassDescriptor,
  GpuRenderPipeline,
  GpuRenderPipelineDescriptor,
  GpuRenderTarget,
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDescriptor,
} from '@canvas/engine';

const CAPABILITIES: GpuCapabilities = {
  backendName: 'webgpu',
  maxTextureSize: 8192,
  hasTimestampQuery: false,
  sampleCount: 1,
  adapterName: 'fake',
  isSoftwareAdapter: false,
};

/** One render pass as recorded: how it began and the draws in it. */
export interface RecordedPass {
  /** The descriptor it began with. */
  readonly descriptor: GpuRenderPassDescriptor;
  /** Its draws: `[vertexCount, instanceCount, firstInstance]`. */
  readonly draws: [number, number, number][];
  /** The pipelines set, by label. */
  readonly pipelines: string[];
}

/** The recording backend. */
export class RecordingGpuBackend implements GpuBackend {
  readonly capabilities = CAPABILITIES;
  /** Every render pass, in order. */
  readonly passes: RecordedPass[] = [];
  /** Labels of the buffers destroyed. */
  readonly destroyedBuffers: string[] = [];
  /** Every `writeBuffer`: the buffer's label and the byte length written. */
  readonly writes: [string, number][] = [];
  /** Each buffer's bytes as written so far, by label. */
  readonly contents = new Map<string, Uint8Array>();

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    const label = descriptor.label ?? '';
    return {
      usage: descriptor.usage,
      byteLength: descriptor.byteLength,
      label,
      destroy: () => {
        this.destroyedBuffers.push(label);
      },
    } as GpuBuffer;
  }

  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void {
    const { label } = buffer as GpuBuffer & { label: string };
    this.writes.push([label, data.byteLength]);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const before = this.contents.get(label) ?? new Uint8Array(0);
    const after = new Uint8Array(Math.max(before.length, byteOffset + bytes.length));
    after.set(before);
    after.set(bytes, byteOffset);
    this.contents.set(label, after);
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    return { ...descriptor, destroy: () => undefined };
  }

  writeTexture(): void {
    // Nothing samples textures here.
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    return { ...descriptor, destroy: () => undefined };
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    return {
      bindings: descriptor.bindings,
      label: descriptor.label,
      destroy: () => undefined,
    } as GpuRenderPipeline;
  }

  createBindGroup(descriptor: { entries: GpuBindGroup['entries'] }): GpuBindGroup {
    return { entries: descriptor.entries };
  }

  createRenderTarget(): GpuRenderTarget {
    throw new Error('These tests draw into no render target.');
  }

  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPass {
    const pass: RecordedPass = { descriptor, draws: [], pipelines: [] };
    this.passes.push(pass);
    return {
      setViewport: () => undefined,
      setPipeline: (pipeline) => {
        pass.pipelines.push(String((pipeline as GpuRenderPipeline & { label?: string }).label));
      },
      setBindGroup: () => undefined,
      setVertexBuffer: () => undefined,
      draw: (vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) => {
        pass.draws.push([vertexCount + firstVertex, instanceCount, firstInstance]);
      },
      end: () => undefined,
    };
  }

  submit(): void {
    // Nothing to submit.
  }

  readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(4));
  }

  collectPassTimings(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  onDeviceLost(): () => void {
    return () => undefined;
  }

  destroy(): void {
    // Nothing to free.
  }
}
