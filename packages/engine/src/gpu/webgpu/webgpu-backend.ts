import { resolveBindGroupEntries } from '../bind-group-layout.js';
import { DeviceLossSignal } from '../device-loss-signal.js';
import type { GpuBackend, GpuDeviceLostListener, GpuPassTiming } from '../gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupDescriptor } from '../gpu-bind-group.js';
import { assertBufferByteLength, assertBufferWrite } from '../gpu-buffer.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../gpu-buffer.js';
import type { GpuCapabilities } from '../gpu-capabilities.js';
import { newDrawStateCounts, type GpuDrawStateCounts } from '../gpu-draw-state-counts.js';
import type { GpuRenderPipeline, GpuRenderPipelineDescriptor } from '../gpu-pipeline.js';
import type { GpuRenderPass, GpuRenderPassDescriptor } from '../gpu-render-pass.js';
import type { GpuRenderTarget, GpuRenderTargetDescriptor } from '../gpu-render-target.js';
import type { GpuShaderSource } from '../gpu-shader.js';
import type {
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDataLayout,
  GpuTextureDescriptor,
  GpuTextureRegion,
} from '../gpu-texture.js';
import { OpenPassGuard } from '../pass-guard.js';
import { alignedBytesPerRow, unpackTextureReadback } from '../pixel-readback.js';
import { resolveTextureWrite } from '../texture-write.js';

import type { WebGpuCanvasTarget } from './webgpu-canvas-target.js';
import type { WebGpuPassTimer } from './webgpu-pass-timer.js';
import { WebGpuPipeline } from './webgpu-pipeline.js';
import { WebGpuRenderPass } from './webgpu-render-pass.js';
import { WebGpuRenderTargets } from './webgpu-render-targets.js';
import {
  WebGpuBindGroup,
  WebGpuBuffer,
  WebGpuSampler,
  WebGpuTexture,
  claimWebGpu,
} from './webgpu-resources.js';

/**
 * The WebGPU implementation of {@link GpuBackend}, the engine's first choice. Passes are
 * recorded into one command encoder per frame and submitted together.
 * Writes go through the queue, which runs them before any later submission; so that a write
 * between two passes is seen by the second pass only, as on WebGL2, a write first submits the
 * passes already recorded.
 */
export class WebGpuBackend implements GpuBackend {
  /** Render passes begun and state actually bound. */
  readonly drawStateCounts: GpuDrawStateCounts = newDrawStateCounts();
  private encoder: GPUCommandEncoder | undefined;
  private readonly passGuard = new OpenPassGuard();
  private readonly shaderModules = new WeakMap<GpuShaderSource, GPUShaderModule>();
  private readonly deviceLoss = new DeviceLossSignal();
  private readonly renderTargets: WebGpuRenderTargets;

  /**
   * Wraps a device already drawing into a configured canvas; use `createGpuBackend`.
   *
   * @param device - The device.
   * @param target - The configured canvas and its attachments.
   * @param timer - The pass timer.
   * @param capabilities - What the device can do.
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly target: WebGpuCanvasTarget,
    private readonly timer: WebGpuPassTimer,
    readonly capabilities: GpuCapabilities,
  ) {
    this.renderTargets = new WebGpuRenderTargets(device, target.colorFormat, target.sampleCount);
    // `lost` also resolves when this backend destroys the device on purpose; `destroy`
    // silences the signal first, so only a real loss is reported.
    void device.lost.then((info) => {
      // The device freed every target's texture: drop the handles.
      this.renderTargets.destroyAll();
      this.deviceLoss.fire({ message: info.message, restored: Promise.resolve() });
    });
  }

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    assertBufferByteLength(descriptor.byteLength);
    const usage =
      (descriptor.usage === 'uniform' ? GPUBufferUsage.UNIFORM : GPUBufferUsage.VERTEX) |
      GPUBufferUsage.COPY_DST;
    const handle = this.device.createBuffer({
      size: descriptor.byteLength,
      usage,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    return new WebGpuBuffer(this.device, handle, descriptor.usage);
  }

  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void {
    this.passGuard.assertClosed('write a buffer');
    const target = claimWebGpu(buffer, WebGpuBuffer, this.device);
    assertBufferWrite(target.byteLength, byteOffset, data.byteLength);
    this.submitRecordedPasses();
    this.device.queue.writeBuffer(
      target.handle,
      byteOffset,
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    const handle = this.device.createTexture({
      size: { width: descriptor.width, height: descriptor.height },
      format: descriptor.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    return new WebGpuTexture(this.device, handle, descriptor.format);
  }

  writeTexture(
    texture: GpuTexture,
    data: ArrayBufferView<ArrayBuffer>,
    region?: GpuTextureRegion,
    layout?: GpuTextureDataLayout,
  ): void {
    this.passGuard.assertClosed('write a texture');
    const target = claimWebGpu(texture, WebGpuTexture, this.device);
    const write = resolveTextureWrite(target, data.byteLength, region, layout);
    this.submitRecordedPasses();
    const { x, y, width, height } = write.region;
    this.device.queue.writeTexture(
      { texture: target.handle, origin: { x, y } },
      data,
      { offset: write.byteOffset, bytesPerRow: write.bytesPerRow },
      { width, height },
    );
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    const { filter, addressMode } = descriptor;
    const handle = this.device.createSampler({
      magFilter: filter,
      minFilter: filter,
      addressModeU: addressMode,
      addressModeV: addressMode,
      ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
    });
    return new WebGpuSampler(this.device, handle, filter, addressMode);
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    return new WebGpuPipeline(this.device, this.shaderModule(descriptor.shader), descriptor, {
      colorFormat: this.target.colorFormat,
      sampleCount: this.target.sampleCount,
    });
  }

  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup {
    const { device } = this;
    const pipeline = claimWebGpu(descriptor.pipeline, WebGpuPipeline, device);
    const resolved = resolveBindGroupEntries(pipeline.bindings, descriptor.entries);
    const entries: GPUBindGroupEntry[] = [
      ...resolved.uniformBuffers.map(({ binding, buffer }) => ({
        binding,
        resource: { buffer: claimWebGpu(buffer, WebGpuBuffer, device).handle },
      })),
      ...resolved.textures.map(({ binding, texture }) => ({
        binding,
        resource: claimWebGpu(texture, WebGpuTexture, device).view,
      })),
      ...resolved.samplers.map(({ binding, sampler }) => ({
        binding,
        resource: claimWebGpu(sampler, WebGpuSampler, device).handle,
      })),
    ];
    const handle = device.createBindGroup({ layout: pipeline.bindGroupLayout, entries });
    return new WebGpuBindGroup(device, handle, descriptor.entries);
  }

  createRenderTarget(descriptor: GpuRenderTargetDescriptor): GpuRenderTarget {
    return this.renderTargets.create(descriptor, this.capabilities.maxTextureSize);
  }

  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPass {
    if (descriptor.target) {
      return this.beginTargetPass(descriptor.target, descriptor);
    }
    this.passGuard.open();
    this.encoder ??= this.device.createCommandEncoder();
    const { colorView, resolveTarget, stencilView } = this.target.attachments();
    const { clearColor } = descriptor;
    const timestampWrites = this.timer.timestampWrites(descriptor.timingLabel);
    const encoder = this.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          ...(resolveTarget ? { resolveTarget } : {}),
          loadOp: clearColor ? 'clear' : 'load',
          storeOp: 'store',
          clearValue: clearColor ?? [0, 0, 0, 0],
        },
      ],
      depthStencilAttachment: {
        view: stencilView,
        stencilLoadOp: clearColor ? 'clear' : 'load',
        stencilStoreOp: 'store',
        stencilClearValue: 0,
      },
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    this.drawStateCounts.renderPasses += 1;
    const onEnd = (): void => {
      this.passGuard.close();
    };
    return new WebGpuRenderPass(this.device, encoder, onEnd, this.drawStateCounts);
  }

  /**
   * Begins a pass into a render target's scratch, viewport on the target's corner; ending it
   * resolves and copies the colour into the target's texture and submits.
   *
   * @param target - A live target of this backend.
   * @param descriptor - The clear colour (transparent by default) and timing label.
   * @returns The open pass.
   */
  private beginTargetPass(
    target: GpuRenderTarget,
    descriptor: GpuRenderPassDescriptor,
  ): GpuRenderPass {
    this.passGuard.assertClosed('begin a render pass');
    const targetPass = this.renderTargets.beginPass(target, descriptor.clearColor ?? [0, 0, 0, 0]);
    this.passGuard.open();
    const commands = (this.encoder ??= this.device.createCommandEncoder());
    const timestampWrites = this.timer.timestampWrites(descriptor.timingLabel);
    const encoder = commands.beginRenderPass({
      ...targetPass.descriptor,
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    // The scratch may be larger than the target: draw into its top-left corner only, and clip
    // there too, so a primitive past the viewport's edge never reaches the scratch beyond it.
    encoder.setViewport(0, 0, target.width, target.height, 0, 1);
    encoder.setScissorRect(0, 0, target.width, target.height);
    this.drawStateCounts.renderPasses += 1;
    const onEnd = (): void => {
      targetPass.land(commands);
      this.passGuard.close();
      // A target's colour is complete when its pass ends, as on WebGL2, whose calls run at once:
      // submit now, so the caller may free what the pass drew with before the frame's submit.
      this.submitRecordedPasses();
    };
    return new WebGpuRenderPass(this.device, encoder, onEnd, this.drawStateCounts);
  }

  submit(): void {
    this.passGuard.assertClosed('submit');
    this.submitRecordedPasses();
  }

  async readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    this.submit();
    const texture = this.target.currentTexture();
    const { width, height } = texture;
    const bytesPerRow = alignedBytesPerRow(width);
    const buffer = this.device.createBuffer({
      label: 'canvas readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.destroy();
    const format = texture.format === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm';
    return unpackTextureReadback(padded, width, height, bytesPerRow, format);
  }

  whenSubmittedWorkDone?(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  collectPassTimings(): Promise<readonly GpuPassTiming[]> {
    return this.timer.collect();
  }

  onDeviceLost(listener: GpuDeviceLostListener): () => void {
    return this.deviceLoss.add(listener);
  }

  loseDeviceForTesting(): void {
    // As an outside loss: the signal stays live, so `device.lost` reports it.
    this.device.destroy();
  }

  destroy(): void {
    this.deviceLoss.silence();
    this.renderTargets.destroyAll();
    this.timer.destroy();
    this.target.destroy();
    this.device.destroy();
  }

  private shaderModule(shader: GpuShaderSource): GPUShaderModule {
    let module = this.shaderModules.get(shader);
    if (!module) {
      module = this.device.createShaderModule({ label: shader.label, code: shader.wgsl });
      this.shaderModules.set(shader, module);
    }
    return module;
  }

  /** Submits the passes recorded so far, with their timestamp resolves; no pass is open. */
  private submitRecordedPasses(): void {
    const { encoder } = this;
    if (!encoder) {
      return;
    }
    this.encoder = undefined;
    this.timer.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timer.afterSubmit();
    this.renderTargets.afterSubmit();
  }
}
