// C2a/C2b: record render targets and their draws alongside the existing fake GPU calls.
// A GpuBackend that draws nothing and records every call, so tests and benchmarks can count
// uploads and draws without a GPU. It enforces the rules the real backends share: buffer writes
// are 4-byte aligned and in bounds, and nothing is written or begun while a pass is open.
import { DeviceLossSignal } from '../../gpu/device-loss-signal.js';
import type { GpuBackend, GpuDeviceLostListener } from '../../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupDescriptor } from '../../gpu/gpu-bind-group.js';
import {
  assertBufferByteLength,
  assertBufferWrite,
  type GpuBuffer,
  type GpuBufferDescriptor,
} from '../../gpu/gpu-buffer.js';
import type { GpuCapabilities } from '../../gpu/gpu-capabilities.js';
import { newDrawStateCounts, type GpuDrawStateCounts } from '../../gpu/gpu-draw-state-counts.js';
import type {
  GpuColorWrite,
  GpuRenderPipeline,
  GpuRenderPipelineDescriptor,
  GpuStencilState,
} from '../../gpu/gpu-pipeline.js';
import type { GpuRenderPass, GpuRenderPassDescriptor } from '../../gpu/gpu-render-pass.js';
import type {
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDescriptor,
} from '../../gpu/gpu-texture.js';
import { OpenPassGuard } from '../../gpu/pass-guard.js';

/** A fake buffer: its label and whether it was destroyed. */
export interface FakeGpuBuffer extends GpuBuffer {
  /** The descriptor's label, or an empty string. */
  readonly label: string;
  /** Whether `destroy` was called. */
  readonly isDestroyed: boolean;
}

/** A fake pipeline: its descriptor's label, colour writes and stencil test. */
export interface FakeGpuPipeline extends GpuRenderPipeline {
  /** The descriptor's label, or an empty string. */
  readonly label: string;
  /** The descriptor's colour writes. */
  readonly colorWrite: GpuColorWrite;
  /** The descriptor's stencil test, if any. */
  readonly stencil: GpuStencilState | undefined;
}

/** A fake texture: its label, size and whether it was destroyed. */
export interface FakeGpuTexture extends GpuTexture {
  /** The descriptor's label, or an empty string. */
  readonly label: string;
  /** Whether `destroy` was called. */
  readonly isDestroyed: boolean;
}

/** A resolved, sampleable offscreen colour target. */
export interface FakeGpuRenderTarget {
  readonly width: number;
  readonly height: number;
  readonly texture: FakeGpuTexture;
  readonly isDestroyed: boolean;
  destroy(): void;
}

/** One recorded backend or pass call. */
export type FakeGpuCall =
  | { readonly method: 'createBuffer'; readonly label: string; readonly byteLength: number }
  | {
      readonly method: 'writeBuffer';
      readonly label: string;
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  | {
      readonly method: 'createTexture';
      readonly label: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly method: 'writeTexture'; readonly label: string; readonly byteLength: number }
  | { readonly method: 'createRenderTarget'; readonly target: FakeGpuRenderTarget }
  | { readonly method: 'setBindGroup'; readonly textureLabel: string | undefined }
  | {
      readonly method: 'beginRenderPass';
      readonly timingLabel: string | undefined;
      readonly target: FakeGpuRenderTarget | undefined;
    }
  | { readonly method: 'setVertexBuffer'; readonly slot: number; readonly label: string }
  | { readonly method: 'setPipeline'; readonly label: string }
  | {
      readonly method: 'draw';
      readonly vertexCount: number;
      readonly instanceCount: number;
      readonly firstVertex: number;
      readonly firstInstance: number;
      readonly target: FakeGpuRenderTarget | undefined;
    }
  | { readonly method: 'createRenderPipeline' | 'createBindGroup' | 'endPass' | 'submit' };

const CAPABILITIES: GpuCapabilities = {
  backendName: 'webgpu',
  maxTextureSize: 8192,
  hasTimestampQuery: false,
  sampleCount: 1,
  adapterName: 'fake',
  isSoftwareAdapter: false,
};

/** The fake backend. `calls` grows with every call; `resetCalls` empties it. */
export class FakeGpuBackend implements GpuBackend {
  /** Hardware-like capabilities; `maxTextureSize` may be set per backend. */
  readonly capabilities: GpuCapabilities;
  /** Every call so far, in order. */
  readonly calls: FakeGpuCall[] = [];
  /** Render passes begun and state bound, as a real backend counts them. */
  readonly drawStateCounts: GpuDrawStateCounts = newDrawStateCounts();
  /** Every buffer created, in order. */
  readonly buffers: FakeGpuBuffer[] = [];
  /** Every texture created, in order. */
  readonly textures: FakeGpuTexture[] = [];
  /** Targets, in creation order. */
  readonly targets: FakeGpuRenderTarget[] = [];
  /** Every pipeline created, in order. */
  readonly pipelines: FakeGpuPipeline[] = [];
  private readonly guard = new OpenPassGuard();
  private readonly deviceLoss = new DeviceLossSignal();
  /** When set, `createTexture` throws once more than this many textures are alive. */
  maxLiveTextures = Number.POSITIVE_INFINITY;

  /**
   * Creates a fake backend.
   *
   * @param options - Overrides of the capabilities.
   * @param options.maxTextureSize - The largest texture edge; default 8192.
   */
  constructor(options: { readonly maxTextureSize?: number } = {}) {
    this.capabilities = { ...CAPABILITIES, maxTextureSize: options.maxTextureSize ?? 8192 };
  }

  /**
   * Counts recorded calls of one method.
   *
   * @param method - The method name.
   * @returns How many times it was called since the last reset.
   */
  count(method: FakeGpuCall['method']): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  /**
   * The recorded buffer writes.
   *
   * @returns Each write's buffer label, offset and length.
   */
  writes(): Extract<FakeGpuCall, { method: 'writeBuffer' }>[] {
    return this.calls.filter(
      (call): call is Extract<FakeGpuCall, { method: 'writeBuffer' }> =>
        call.method === 'writeBuffer',
    );
  }

  /**
   * The recorded draws.
   *
   * @returns Each draw's counts.
   */
  draws(): Extract<FakeGpuCall, { method: 'draw' }>[] {
    return this.calls.filter(
      (call): call is Extract<FakeGpuCall, { method: 'draw' }> => call.method === 'draw',
    );
  }

  /** Forgets the recorded calls. */
  resetCalls(): void {
    this.calls.length = 0;
  }

  /**
   * The textures created and not destroyed.
   *
   * @returns Them, in creation order.
   */
  liveTextures(): FakeGpuTexture[] {
    return this.textures.filter((texture) => !texture.isDestroyed);
  }

  /**
   * Simulates a lost device: tells the `onDeviceLost` listeners.
   *
   * @param restored - When a new backend may be made; default at once.
   */
  loseDevice(restored: Promise<void> = Promise.resolve()): void {
    for (const target of this.targets) target.destroy();
    this.deviceLoss.fire({ message: 'fake device lost', restored });
  }

  /** Loses the device at once, as the real backends' test hook does. */
  loseDeviceForTesting(): void {
    this.loseDevice();
  }

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    assertBufferByteLength(descriptor.byteLength);
    const label = descriptor.label ?? '';
    const buffer = {
      usage: descriptor.usage,
      byteLength: descriptor.byteLength,
      label,
      isDestroyed: false,
      destroy(): void {
        buffer.isDestroyed = true;
      },
    };
    this.buffers.push(buffer);
    this.calls.push({ method: 'createBuffer', label, byteLength: descriptor.byteLength });
    return buffer;
  }

  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void {
    this.guard.assertClosed('write a buffer');
    assertBufferWrite(buffer.byteLength, byteOffset, data.byteLength);
    const { label } = buffer as FakeGpuBuffer;
    if ((buffer as FakeGpuBuffer).isDestroyed) throw new Error(`Buffer "${label}" is destroyed.`);
    this.calls.push({ method: 'writeBuffer', label, byteOffset, byteLength: data.byteLength });
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    if (this.liveTextures().length >= this.maxLiveTextures) {
      throw new Error('fake out of GPU memory');
    }
    const label = descriptor.label ?? '';
    const texture = {
      format: descriptor.format,
      width: descriptor.width,
      height: descriptor.height,
      label,
      isDestroyed: false,
      destroy(): void {
        texture.isDestroyed = true;
      },
    };
    this.textures.push(texture);
    const { width, height } = descriptor;
    this.calls.push({ method: 'createTexture', label, width, height });
    return texture;
  }

  /**
   * Allocates a render target matching the canvas colour format.
   *
   * @param descriptor - The size in device pixels.
   * @param descriptor.width - Width in device pixels.
   * @param descriptor.height - Height in device pixels.
   * @returns The target, its texture recorded among `textures`.
   * @throws {RangeError} When an edge is not a whole number in [1, `maxTextureSize`].
   */
  createRenderTarget(descriptor: {
    readonly width: number;
    readonly height: number;
  }): FakeGpuRenderTarget {
    const { width, height } = descriptor;
    const maximum = this.capabilities.maxTextureSize;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > maximum ||
      height > maximum
    ) {
      throw new RangeError(
        'A render target size must be positive and within the device texture limit.',
      );
    }
    const texture = this.createTexture({
      format: 'rgba8unorm',
      width,
      height,
      label: 'layer-target',
    }) as FakeGpuTexture;
    const target: FakeGpuRenderTarget = {
      width,
      height,
      texture,
      isDestroyed: false,
      destroy(): void {
        texture.destroy();
        (target as { isDestroyed: boolean }).isDestroyed = true;
      },
    };
    this.targets.push(target);
    this.calls.push({ method: 'createRenderTarget', target });
    return target;
  }

  writeTexture(texture: GpuTexture, data: ArrayBufferView<ArrayBuffer>): void {
    this.guard.assertClosed('write a texture');
    const { label, isDestroyed } = texture as FakeGpuTexture;
    if (isDestroyed) throw new Error(`Texture "${label}" is destroyed.`);
    this.calls.push({ method: 'writeTexture', label, byteLength: data.byteLength });
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    return { ...descriptor, destroy: () => undefined };
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    this.calls.push({ method: 'createRenderPipeline' });
    const pipeline: FakeGpuPipeline = {
      bindings: descriptor.bindings,
      label: descriptor.label ?? '',
      colorWrite: descriptor.colorWrite ?? 'all',
      stencil: descriptor.stencil,
      destroy: () => undefined,
    };
    this.pipelines.push(pipeline);
    return pipeline;
  }

  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup {
    this.calls.push({ method: 'createBindGroup' });
    return { entries: descriptor.entries };
  }

  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPass {
    const target = (descriptor as GpuRenderPassDescriptor & { target?: FakeGpuRenderTarget })
      .target;
    // As both backends do: a pass may only draw into a live target this backend created.
    if (target !== undefined && (target.isDestroyed || !this.targets.includes(target))) {
      throw new Error('A render pass target must be a live target of the same backend.');
    }
    this.guard.open();
    this.calls.push({ method: 'beginRenderPass', timingLabel: descriptor.timingLabel, target });
    const { calls, guard, drawStateCounts: counts } = this;
    counts.renderPasses += 1;
    // Counted as WebGPU's pass binds: only state that changes.
    let boundPipeline: unknown;
    let boundGroup: unknown;
    return {
      setViewport: () => undefined,
      setPipeline(pipeline): void {
        if (pipeline !== boundPipeline) counts.pipelineSwitches += 1;
        boundPipeline = pipeline;
        calls.push({ method: 'setPipeline', label: (pipeline as FakeGpuPipeline).label });
      },
      setBindGroup(group): void {
        if (group !== boundGroup) counts.bindGroupChanges += 1;
        boundGroup = group;
        const entry = group.entries.find((candidate) => 'texture' in candidate);
        const texture = entry !== undefined && 'texture' in entry ? entry.texture : undefined;
        calls.push({
          method: 'setBindGroup',
          textureLabel: (texture as FakeGpuTexture | undefined)?.label,
        });
      },
      setVertexBuffer(slot, buffer): void {
        calls.push({ method: 'setVertexBuffer', slot, label: (buffer as FakeGpuBuffer).label });
      },
      draw(vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        calls.push({
          method: 'draw',
          vertexCount,
          instanceCount,
          firstVertex,
          firstInstance,
          target,
        });
      },
      end(): void {
        guard.close();
        calls.push({ method: 'endPass' });
      },
    };
  }

  submit(): void {
    this.guard.assertClosed('submit');
    this.calls.push({ method: 'submit' });
  }

  readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(new Uint8Array(0));
  }

  collectPassTimings(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  onDeviceLost(listener: GpuDeviceLostListener): () => void {
    return this.deviceLoss.add(listener);
  }

  destroy(): void {
    this.deviceLoss.silence();
    for (const buffer of this.buffers) buffer.destroy();
    for (const target of this.targets) target.destroy();
  }
}
