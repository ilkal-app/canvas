import type { GpuSampleCount } from '../gpu-capabilities.js';
import type {
  GpuBindingLayoutEntry,
  GpuRenderPipeline,
  GpuRenderPipelineDescriptor,
  GpuStencilState,
} from '../gpu-pipeline.js';
import { resolveVertexBufferLayouts } from '../vertex-layout.js';

/** Every canvas pass has a stencil attachment (even-odd fills), so every pipeline declares it. */
export const STENCIL_FORMAT: GPUTextureFormat = 'stencil8';

/** The render target a pipeline draws into. */
export interface WebGpuTargetFormat {
  /** The canvas colour format. */
  readonly colorFormat: GPUTextureFormat;
  /** Samples per pixel of the colour and stencil attachments. */
  readonly sampleCount: GpuSampleCount;
}

const PREMULTIPLIED_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/**
 * One face's stencil state.
 *
 * @param stencil - The pipeline's stencil test, if any.
 * @param isBack - Whether this is the back face, which may have an operation of its own.
 * @returns The face's state.
 */
function stencilFace(stencil: GpuStencilState | undefined, isBack: boolean): GPUStencilFaceState {
  const operation = isBack
    ? (stencil?.backPassOperation ?? stencil?.passOperation)
    : stencil?.passOperation;
  return {
    compare: stencil?.compare ?? 'always',
    passOp: operation ?? 'keep',
    failOp: 'keep',
    depthFailOp: 'keep',
  };
}

function bindGroupLayoutEntry(entry: GpuBindingLayoutEntry): GPUBindGroupLayoutEntry {
  const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  switch (entry.kind) {
    case 'uniform-buffer':
      return { binding: entry.binding, visibility, buffer: { type: 'uniform' } };
    case 'load-texture':
      return { binding: entry.binding, visibility, texture: { sampleType: 'unfilterable-float' } };
    case 'texture':
      return { binding: entry.binding, visibility, texture: { sampleType: 'float' } };
    case 'sampler':
      return { binding: entry.binding, visibility, sampler: { type: 'filtering' } };
  }
}

/** A WebGPU render pipeline with an explicit group-0 layout, so bind groups outlive pipelines. */
export class WebGpuPipeline implements GpuRenderPipeline {
  /** The owning device. */
  readonly device: GPUDevice;
  /** The group-0 bindings bind groups must fill. */
  readonly bindings: readonly GpuBindingLayoutEntry[];
  /** The group-0 layout bind groups are created against. */
  readonly bindGroupLayout: GPUBindGroupLayout;
  /** The WebGPU pipeline. */
  readonly handle: GPURenderPipeline;
  /**
   * The stencil reference its test compares with, set on the pass when it is selected; absent
   * for 0, the pass default.
   */
  readonly stencilReference?: number;

  /**
   * Creates the pipeline.
   *
   * @param device - The owning device.
   * @param module - The compiled WGSL of `descriptor.shader`.
   * @param descriptor - The pipeline description.
   * @param target - The canvas colour format and sample count.
   */
  constructor(
    device: GPUDevice,
    module: GPUShaderModule,
    descriptor: GpuRenderPipelineDescriptor,
    target: WebGpuTargetFormat,
  ) {
    this.device = device;
    this.bindings = descriptor.bindings;
    const reference = descriptor.stencil?.reference;
    if (reference !== undefined && reference !== 0) this.stencilReference = reference;
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: descriptor.bindings.map(bindGroupLayoutEntry),
    });
    this.handle = device.createRenderPipeline({
      label: descriptor.label ?? descriptor.shader.label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: descriptor.shader.vertexEntryPoint,
        buffers: resolveVertexBufferLayouts(descriptor.vertexBuffers).map((layout) => ({
          arrayStride: layout.byteStride,
          stepMode: layout.stepMode,
          attributes: layout.attributes.map(({ location, format, byteOffset }) => ({
            shaderLocation: location,
            format,
            offset: byteOffset,
          })),
        })),
      },
      fragment: {
        module,
        entryPoint: descriptor.shader.fragmentEntryPoint,
        targets: [
          {
            format: target.colorFormat,
            ...(descriptor.blend === 'premultiplied' ? { blend: PREMULTIPLIED_BLEND } : {}),
            writeMask: (descriptor.colorWrite ?? 'all') === 'all' ? GPUColorWrite.ALL : 0,
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: STENCIL_FORMAT,
        stencilFront: stencilFace(descriptor.stencil, false),
        stencilBack: stencilFace(descriptor.stencil, true),
        stencilReadMask: descriptor.stencil?.readMask ?? 0xff,
        stencilWriteMask: descriptor.stencil?.writeMask ?? 0xff,
      },
      multisample: { count: target.sampleCount },
    });
  }

  /** Does nothing: WebGPU releases pipelines by garbage collection, and with their device. */
  destroy(): void {
    // No explicit release exists in WebGPU.
  }
}
