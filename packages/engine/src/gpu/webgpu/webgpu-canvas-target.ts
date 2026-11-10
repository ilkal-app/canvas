import type { GpuSampleCount } from '../gpu-capabilities.js';

import { STENCIL_FORMAT } from './webgpu-pipeline.js';

/** The attachments one pass renders into. */
export interface WebGpuFrameAttachments {
  /** Where colour is drawn: the canvas texture, or the multisampled texture when MSAA is on. */
  readonly colorView: GPUTextureView;
  /** The canvas texture the multisampled colour resolves into; absent without MSAA. */
  readonly resolveTarget: GPUTextureView | undefined;
  /** The stencil attachment. */
  readonly stencilView: GPUTextureView;
}

/**
 * The canvas's configured context plus the stencil (and, with MSAA, multisampled colour)
 * textures that match its size. They are recreated when the canvas is resized.
 */
export class WebGpuCanvasTarget {
  private stencil: GPUTexture | undefined;
  private multisampledColor: GPUTexture | undefined;

  /**
   * Configures the canvas context for premultiplied output that can also be read back.
   *
   * @param device - The device drawing into the canvas.
   * @param context - The canvas's `webgpu` context.
   * @param colorFormat - The canvas colour format.
   * @param sampleCount - Samples per pixel.
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    readonly colorFormat: GPUTextureFormat,
    readonly sampleCount: GpuSampleCount,
  ) {
    context.configure({
      device,
      format: colorFormat,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  /**
   * The canvas texture of the current frame; the same texture until the frame is presented.
   *
   * @returns The texture passes draw or resolve into.
   */
  currentTexture(): GPUTexture {
    return this.context.getCurrentTexture();
  }

  /**
   * The attachments for a pass of the current frame, sized to the canvas.
   *
   * @returns The colour, resolve and stencil views.
   */
  attachments(): WebGpuFrameAttachments {
    const canvasTexture = this.currentTexture();
    const { width, height } = canvasTexture;
    const stencil =
      this.stencil?.width === width && this.stencil.height === height
        ? this.stencil
        : this.recreate(width, height);
    const stencilView = stencil.createView();
    const canvasView = canvasTexture.createView();
    return this.multisampledColor
      ? { colorView: this.multisampledColor.createView(), resolveTarget: canvasView, stencilView }
      : { colorView: canvasView, resolveTarget: undefined, stencilView };
  }

  /** Frees the stencil and multisampled textures and releases the canvas. */
  destroy(): void {
    this.stencil?.destroy();
    this.multisampledColor?.destroy();
    this.context.unconfigure();
  }

  private recreate(width: number, height: number): GPUTexture {
    this.stencil?.destroy();
    this.multisampledColor?.destroy();
    const size = { width, height };
    const usage = GPUTextureUsage.RENDER_ATTACHMENT;
    const stencil = this.device.createTexture({
      label: 'canvas stencil',
      size,
      format: STENCIL_FORMAT,
      sampleCount: this.sampleCount,
      usage,
    });
    this.multisampledColor =
      this.sampleCount > 1
        ? this.device.createTexture({
            label: 'canvas multisampled colour',
            size,
            format: this.colorFormat,
            sampleCount: this.sampleCount,
            usage,
          })
        : undefined;
    this.stencil = stencil;
    return stencil;
  }
}
