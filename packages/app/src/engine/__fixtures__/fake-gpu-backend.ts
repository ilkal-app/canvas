// A GpuBackend that draws nothing, for unit tests that need a SceneRenderer (the scene feed's);
// real rendering is covered by the scenario tests and golden scenes in Chrome.
import type {
  GpuBackend,
  GpuBindGroup,
  GpuBuffer,
  GpuBufferDescriptor,
  GpuCapabilities,
  GpuRenderPass,
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

/** The fake backend: every call succeeds and draws nothing; `readPixels` reads nothing. */
export class FakeGpuBackend implements GpuBackend {
  readonly capabilities = CAPABILITIES;

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    return {
      usage: descriptor.usage,
      byteLength: descriptor.byteLength,
      label: descriptor.label ?? '',
      destroy: () => undefined,
    } as GpuBuffer;
  }

  writeBuffer(): void {
    // Nothing reads the buffers in these tests.
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    return { ...descriptor, destroy: () => undefined };
  }

  writeTexture(): void {
    // Nothing samples textures in these tests.
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    return { ...descriptor, destroy: () => undefined };
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    return { bindings: descriptor.bindings, destroy: () => undefined };
  }

  createBindGroup(descriptor: { entries: GpuBindGroup['entries'] }): GpuBindGroup {
    return { entries: descriptor.entries };
  }

  createRenderTarget(): GpuRenderTarget {
    throw new Error('These tests draw into no render target.');
  }

  beginRenderPass(): GpuRenderPass {
    return {
      setViewport: () => undefined,
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      setVertexBuffer: () => undefined,
      draw: () => undefined,
      end: () => undefined,
    };
  }

  submit(): void {
    // Nothing is presented.
  }

  readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(0));
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
