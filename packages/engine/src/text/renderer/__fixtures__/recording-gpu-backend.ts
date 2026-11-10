// A GpuBackend that records every call instead of touching a GPU, and rejects writes inside an
// open pass as both real backends do, so the text renderer's call sequence is unit-tested; the
// pixels are tested on a real GPU (the golden text scenes, tooling/golden/scenes/text-scenes.ts).
import type { GpuBackend, GpuPassTiming } from '../../../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupDescriptor } from '../../../gpu/gpu-bind-group.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../../../gpu/gpu-buffer.js';
import type { GpuCapabilities } from '../../../gpu/gpu-capabilities.js';
import type { GpuRenderPipeline, GpuRenderPipelineDescriptor } from '../../../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../../../gpu/gpu-render-pass.js';
import type { GpuRenderTarget } from '../../../gpu/gpu-render-target.js';
import type {
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDescriptor,
  GpuTextureRegion,
} from '../../../gpu/gpu-texture.js';

/** A recorded call: its name and a summary of its arguments. */
export interface RecordedCall {
  /** The method, such as `createTexture` or `pass.draw`. */
  readonly name: string;
  /** What it was called with. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** A recording GpuBackend. */
export class RecordingGpuBackend implements GpuBackend {
  /** Fixed capabilities, with a configurable texture limit. */
  readonly capabilities: GpuCapabilities;
  /** Every call, in order. */
  readonly calls: RecordedCall[] = [];
  /** Handles destroyed so far, by label. */
  readonly destroyed: string[] = [];
  private isPassOpen = false;

  /**
   * Creates the backend.
   *
   * @param maxTextureSize - The largest texture side it accepts. Default 8192.
   */
  constructor(maxTextureSize = 8192) {
    this.capabilities = {
      backendName: 'webgpu',
      maxTextureSize,
      hasTimestampQuery: false,
      sampleCount: 1,
      adapterName: 'recording',
      isSoftwareAdapter: false,
    };
  }

  /**
   * The recorded calls with a name.
   *
   * @param name - The method name.
   * @returns Their details, in order.
   */
  callsNamed(name: string): Readonly<Record<string, unknown>>[] {
    return this.calls.filter((call) => call.name === name).map(({ details }) => details);
  }

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    this.record('createBuffer', { ...descriptor });
    return {
      ...descriptor,
      destroy: () => this.destroyed.push(`buffer:${descriptor.label ?? ''}`),
    };
  }

  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void {
    this.assertNoPass('buffer');
    this.record('writeBuffer', { buffer, byteOffset, byteLength: data.byteLength, data });
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    this.record('createTexture', { ...descriptor });
    return {
      ...descriptor,
      destroy: () => this.destroyed.push(`texture:${descriptor.label ?? ''}`),
    };
  }

  writeTexture(
    texture: GpuTexture,
    data: ArrayBufferView<ArrayBuffer>,
    region?: GpuTextureRegion,
  ): void {
    this.assertNoPass('texture');
    this.record('writeTexture', { texture, byteLength: data.byteLength, region });
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    this.record('createSampler', { ...descriptor });
    return { ...descriptor, destroy: () => this.destroyed.push('sampler') };
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    this.record('createRenderPipeline', { label: descriptor.label, blend: descriptor.blend });
    return { bindings: descriptor.bindings, destroy: () => this.destroyed.push('pipeline') };
  }

  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup {
    this.record('createBindGroup', { entries: descriptor.entries });
    return { entries: descriptor.entries };
  }

  createRenderTarget(): GpuRenderTarget {
    throw new Error('These tests draw into no render target.');
  }

  beginRenderPass(): GpuRenderPass {
    this.isPassOpen = true;
    const record = (name: string, details: Record<string, unknown>): void => {
      this.record(`pass.${name}`, details);
    };
    return {
      setViewport: (viewport) => {
        record('setViewport', { viewport });
      },
      setPipeline: (pipeline) => {
        record('setPipeline', { pipeline });
      },
      setBindGroup: (bindGroup) => {
        record('setBindGroup', { bindGroup });
      },
      setVertexBuffer: (slot, buffer) => {
        record('setVertexBuffer', { slot, buffer });
      },
      draw: (vertexCount, instanceCount, firstVertex, firstInstance) => {
        record('draw', { vertexCount, instanceCount, firstVertex, firstInstance });
      },
      end: () => {
        this.isPassOpen = false;
      },
    };
  }

  submit(): void {
    this.record('submit', {});
  }

  readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(0));
  }

  collectPassTimings(): Promise<readonly GpuPassTiming[]> {
    return Promise.resolve([]);
  }

  onDeviceLost(): () => void {
    return () => undefined;
  }

  destroy(): void {
    this.record('destroy', {});
  }

  private record(name: string, details: Record<string, unknown>): void {
    this.calls.push({ name, details });
  }

  private assertNoPass(what: string): void {
    if (this.isPassOpen) throw new Error(`Cannot write a ${what} while a render pass is open.`);
  }
}
