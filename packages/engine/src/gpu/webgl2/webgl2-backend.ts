import { resolveBindGroupEntries } from '../bind-group-layout.js';
import { DeviceLossSignal } from '../device-loss-signal.js';
import type { GpuBackend, GpuDeviceLostListener, GpuPassTiming } from '../gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupDescriptor } from '../gpu-bind-group.js';
import { assertBufferByteLength, assertBufferWrite } from '../gpu-buffer.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../gpu-buffer.js';
import { asContextSource } from '../gpu-canvas.js';
import type { GpuCanvas } from '../gpu-canvas.js';
import type { GpuCapabilities, GpuSampleCount } from '../gpu-capabilities.js';
import { newDrawStateCounts, type GpuDrawStateCounts } from '../gpu-draw-state-counts.js';
import type { GpuRenderPipeline, GpuRenderPipelineDescriptor } from '../gpu-pipeline.js';
import type { GpuColor, GpuRenderPass, GpuRenderPassDescriptor } from '../gpu-render-pass.js';
import type { GpuRenderTarget, GpuRenderTargetDescriptor } from '../gpu-render-target.js';
import type {
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDataLayout,
  GpuTextureDescriptor,
  GpuTextureRegion,
} from '../gpu-texture.js';
import { OpenPassGuard } from '../pass-guard.js';
import { flipRows } from '../pixel-readback.js';
import { ResourceTracker } from '../resource-tracker.js';
import { resolveTextureWrite } from '../texture-write.js';

import { readRendererName, resolveWebGl2Capabilities } from './webgl2-capabilities.js';
import { waitForFence } from './webgl2-fence.js';
import { WebGl2PassTimer } from './webgl2-pass-timer.js';
import { WebGl2Pipeline } from './webgl2-pipeline.js';
import { WebGl2ProgramCache } from './webgl2-program-cache.js';
import { WebGl2RenderPass } from './webgl2-render-pass.js';
import { WebGl2RenderTargets } from './webgl2-render-targets.js';
import {
  WebGl2BindGroup,
  WebGl2Buffer,
  WebGl2Sampler,
  WebGl2Texture,
  claimWebGl2,
} from './webgl2-resources.js';

function readCapabilities(gl: WebGL2RenderingContext, timer: WebGl2PassTimer): GpuCapabilities {
  const rendererName = readRendererName({
    renderer: () => {
      const renderer: unknown = gl.getParameter(gl.RENDERER);
      return renderer;
    },
    unmaskedRenderer: () => {
      const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const unmasked: unknown = rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : undefined;
      return unmasked;
    },
  });
  return resolveWebGl2Capabilities({
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    rendererName,
    hasTimerQuery: timer.isSupported,
    samples: Number(gl.getParameter(gl.SAMPLES)),
  });
}

/**
 * The WebGL2 implementation of {@link GpuBackend}, the peer of WebGPU for browsers without it.
 * It compiles the GLSL ES 3.0 that naga generates from each WGSL
 * shader, emulates base-instance draws by re-aiming attribute pointers, and pairs each texture
 * with its sampler on one texture unit.
 */
export class WebGl2Backend implements GpuBackend {
  /** What this backend can do. */
  readonly capabilities: GpuCapabilities;
  /** Render passes begun and state applied. */
  readonly drawStateCounts: GpuDrawStateCounts = newDrawStateCounts();
  private readonly timer: WebGl2PassTimer;
  private readonly passGuard = new OpenPassGuard();
  private readonly resources = new ResourceTracker();
  private readonly programs: WebGl2ProgramCache;
  private readonly deviceLoss = new DeviceLossSignal();
  private readonly stopWatchingContext: () => void;
  private readonly renderTargets: WebGl2RenderTargets;

  /**
   * Wraps a WebGL2 context created with a stencil buffer and premultiplied alpha.
   *
   * @param gl - The canvas's context.
   */
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.programs = new WebGl2ProgramCache(gl);
    this.timer = new WebGl2PassTimer(gl);
    this.capabilities = readCapabilities(gl, this.timer);
    // Texture rows of any width upload without padding (r8unorm rows are 1 byte per texel).
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    this.renderTargets = new WebGl2RenderTargets(gl, this.capabilities.sampleCount, this.resources);
    // A lost context took every target's texture with it: drop the handles before the owner
    // hears of the loss.
    this.deviceLoss.add(() => {
      this.renderTargets.destroyAll();
    });
    this.stopWatchingContext = watchContextLoss(gl.canvas, this.deviceLoss);
  }

  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer {
    assertBufferByteLength(descriptor.byteLength);
    const { gl } = this;
    const { usage, byteLength } = descriptor;
    const buffer = new WebGl2Buffer(gl, gl.createBuffer(), usage, byteLength, this.resources);
    gl.bindBuffer(buffer.target, buffer.handle);
    gl.bufferData(buffer.target, descriptor.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(buffer.target, null);
    return buffer;
  }

  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void {
    this.passGuard.assertClosed('write a buffer');
    const target = claimWebGl2(buffer, WebGl2Buffer, this.gl);
    assertBufferWrite(target.byteLength, byteOffset, data.byteLength);
    const { gl } = this;
    gl.bindBuffer(target.target, target.handle);
    gl.bufferSubData(target.target, byteOffset, data);
    gl.bindBuffer(target.target, null);
  }

  createTexture(descriptor: GpuTextureDescriptor): GpuTexture {
    const { gl } = this;
    const { format, width, height } = descriptor;
    const handle = gl.createTexture();
    const texture = new WebGl2Texture(gl, handle, format, width, height, this.resources);
    gl.bindTexture(gl.TEXTURE_2D, texture.handle);
    const internalFormat =
      format === 'rgba32float' ? gl.RGBA32F : format === 'rgba8unorm' ? gl.RGBA8 : gl.R8;
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
    // Load-only textures have no sampler object; their single mip must be complete.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  writeTexture(
    texture: GpuTexture,
    data: ArrayBufferView<ArrayBuffer>,
    region?: GpuTextureRegion,
    layout?: GpuTextureDataLayout,
  ): void {
    this.passGuard.assertClosed('write a texture');
    const target = claimWebGl2(texture, WebGl2Texture, this.gl);
    const write = resolveTextureWrite(target, data.byteLength, region, layout);
    const isFloat = target.format === 'rgba32float';
    const floatLength = Math.floor(data.byteLength / 4);
    const floatBytes =
      !isFloat || data.byteOffset % 4 === 0
        ? data.buffer
        : data.buffer.slice(data.byteOffset, data.byteOffset + floatLength * 4);
    const bytes = isFloat
      ? new Float32Array(floatBytes, data.byteOffset % 4 === 0 ? data.byteOffset : 0, floatLength)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const { gl } = this;
    const { x, y, width, height } = write.region;
    gl.bindTexture(gl.TEXTURE_2D, target.handle);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, write.rowLengthTexels);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      target.uploadFormat,
      isFloat ? gl.FLOAT : gl.UNSIGNED_BYTE,
      bytes,
      write.byteOffset / (isFloat ? 4 : 1),
    );
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler {
    const { gl } = this;
    const { filter: filterMode, addressMode } = descriptor;
    const handle = gl.createSampler();
    const sampler = new WebGl2Sampler(gl, handle, filterMode, addressMode, this.resources);
    const filter = filterMode === 'linear' ? gl.LINEAR : gl.NEAREST;
    const wrap = addressMode === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.samplerParameteri(sampler.handle, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(sampler.handle, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(sampler.handle, gl.TEXTURE_WRAP_S, wrap);
    gl.samplerParameteri(sampler.handle, gl.TEXTURE_WRAP_T, wrap);
    return sampler;
  }

  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline {
    return new WebGl2Pipeline(this.gl, descriptor, this.resources, this.programs);
  }

  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup {
    const { gl } = this;
    const pipeline = claimWebGl2(descriptor.pipeline, WebGl2Pipeline, gl);
    const resolved = resolveBindGroupEntries(pipeline.bindings, descriptor.entries);
    const uniformBuffers = resolved.uniformBuffers.map(({ binding, buffer }) => ({
      binding,
      buffer: claimWebGl2(buffer, WebGl2Buffer, gl),
    }));
    const textureUnits = resolved.textures.map(({ binding, texture, sampler }) => ({
      unit: binding,
      texture: claimWebGl2(texture, WebGl2Texture, gl),
      sampler: sampler === undefined ? undefined : claimWebGl2(sampler, WebGl2Sampler, gl),
    }));
    return new WebGl2BindGroup(gl, descriptor.entries, uniformBuffers, textureUnits);
  }

  createRenderTarget(descriptor: GpuRenderTargetDescriptor): GpuRenderTarget {
    return this.renderTargets.create(descriptor, this.capabilities.maxTextureSize);
  }

  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPass {
    if (descriptor.target) {
      return this.beginTargetPass(descriptor.target, descriptor);
    }
    this.passGuard.open();
    const { gl } = this;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    if (descriptor.clearColor) {
      this.clear(descriptor.clearColor);
    }
    this.timer.begin(descriptor.timingLabel);
    this.drawStateCounts.renderPasses += 1;
    const onEnd = (): void => {
      this.timer.end();
      this.passGuard.close();
    };
    return new WebGl2RenderPass(gl, height, onEnd, this.drawStateCounts);
  }

  /**
   * Begins a pass into the shared scratch framebuffer, viewport on the target's bottom-left
   * corner; ending it resolves the corner into the target's texture with `blitFramebuffer`.
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
    const bound = this.renderTargets.bind(target);
    this.passGuard.open();
    this.clear(descriptor.clearColor ?? [0, 0, 0, 0]);
    this.timer.begin(descriptor.timingLabel);
    this.drawStateCounts.renderPasses += 1;
    const onEnd = (): void => {
      bound.resolve();
      this.timer.end();
      this.passGuard.close();
    };
    return new WebGl2RenderPass(this.gl, bound.height, onEnd, this.drawStateCounts);
  }

  /**
   * Clears the bound framebuffer's colour and stencil.
   *
   * @param color - The premultiplied clear colour.
   */
  private clear(color: GpuColor): void {
    const { gl } = this;
    // Clears obey the colour and stencil write masks a previous pipeline may have narrowed.
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.clearColor(...color);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  submit(): void {
    this.passGuard.assertClosed('submit');
    this.gl.flush();
  }

  whenSubmittedWorkDone?(): Promise<void> {
    return waitForFence(this.gl);
  }

  readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    const { gl } = this;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    return Promise.resolve(flipRows(bottomUp, width, height));
  }

  collectPassTimings(): Promise<readonly GpuPassTiming[]> {
    return this.timer.collect();
  }

  onDeviceLost(listener: GpuDeviceLostListener): () => void {
    return this.deviceLoss.add(listener);
  }

  loseDeviceForTesting(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  destroy(): void {
    this.deviceLoss.silence();
    this.stopWatchingContext();
    this.timer.destroy();
    this.resources.destroyAll();
    this.passGuard.close();
  }
}

/**
 * Reports a lost WebGL2 context: `webglcontextlost` is cancelled so the browser may restore the
 * context, and the loss's `restored` settles at `webglcontextrestored`, when a new backend can
 * be built on the same canvas.
 *
 * @param canvas - The context's canvas.
 * @param signal - Where the loss is reported.
 * @returns Stops watching.
 */
function watchContextLoss(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  signal: DeviceLossSignal,
): () => void {
  let markRestored: () => void = () => undefined;
  const restored = new Promise<void>((resolve) => {
    markRestored = resolve;
  });
  const onLost = (event: Event): void => {
    event.preventDefault();
    signal.fire({ message: 'The WebGL2 context was lost.', restored });
  };
  const onRestored = (): void => {
    markRestored();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}

/**
 * Creates the WebGL2 backend when the canvas offers a `webgl2` context. The context has a
 * stencil buffer (even-odd path fills), premultiplied alpha and no depth buffer.
 *
 * @param canvas - The canvas to draw into.
 * @param sampleCount - 4 for a multisampled drawing buffer, 1 for none.
 * @returns The backend, or `undefined` when WebGL2 is unavailable.
 */
export function createWebGl2Backend(
  canvas: GpuCanvas,
  sampleCount: GpuSampleCount,
): WebGl2Backend | undefined {
  const gl = asContextSource(canvas).getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: sampleCount === 4,
    depth: false,
    stencil: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  return gl ? new WebGl2Backend(gl) : undefined;
}
