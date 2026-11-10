import type { GpuBackend } from './gpu-backend.js';
import type { GpuBindGroup } from './gpu-bind-group.js';
import type { GpuBuffer } from './gpu-buffer.js';
import type { GpuBindingLayoutEntry, GpuRenderPipeline } from './gpu-pipeline.js';
import type { GpuRenderPass, GpuViewport } from './gpu-render-pass.js';
import { isRenderTargetBottomUp } from './gpu-render-target.js';
import type { GpuRenderTarget } from './gpu-render-target.js';
import type { GpuSampler } from './gpu-texture.js';
import { LAYER_COMPOSITE_SHADER } from './shaders/layer-composite.generated.js';
import type { GpuVertexBufferLayout } from './vertex-layout.js';

/** The composite's bindings: its uniform, then the layer's texture and sampler. */
const LAYER_COMPOSITE_BINDINGS: readonly GpuBindingLayoutEntry[] = [
  { binding: 0, kind: 'uniform-buffer' },
  { binding: 1, kind: 'texture', samplerBinding: 2 },
  { binding: 2, kind: 'sampler' },
];

/** One vertex buffer of unit-square corners, `float32x2` at location 0. */
const LAYER_COMPOSITE_VERTEX_BUFFERS: readonly GpuVertexBufferLayout[] = [
  { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
];

/** The unit square as two triangles, x right and y down. */
const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/** The uniform's size in bytes: opacity, row flip, the uv scale and the clip rectangle. */
export const LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH = 32;

/** Where a composite lands in its pass and which part of its target it shows. */
export interface LayerCompositePlacement {
  /** The layer's rectangle in clip space: left, top, right, bottom. */
  readonly clip: readonly [left: number, top: number, right: number, bottom: number];
  /** The drawn part of the target: the rectangle's size over the target's size, per axis. */
  readonly uvScale: readonly [x: number, y: number];
}

/** The whole viewport and the whole target: a composite drawn at its own viewport. */
const WHOLE_VIEWPORT: LayerCompositePlacement = { clip: [-1, 1, 1, -1], uvScale: [1, 1] };

/**
 * Places a composite inside an open pass without changing its viewport: the
 * rectangle, in device pixels of a pass `passWidth × passHeight` (the canvas, or a parent layer's
 * target), as clip space, and the part of a possibly larger pooled target it shows. Pure.
 *
 * @param rect - Where the layer lands, device pixels from the pass's top-left corner.
 * @param pass - The pass's size in device pixels.
 * @param pass.width - Its width.
 * @param pass.height - Its height.
 * @param target - The target's size, at least the rectangle's.
 * @param target.width - Its width.
 * @param target.height - Its height.
 * @returns The placement.
 */
export function layerCompositePlacement(
  rect: GpuViewport,
  pass: { readonly width: number; readonly height: number },
  target: { readonly width: number; readonly height: number },
): LayerCompositePlacement {
  return {
    clip: [
      (2 * rect.x) / pass.width - 1,
      1 - (2 * rect.y) / pass.height,
      (2 * (rect.x + rect.width)) / pass.width - 1,
      1 - (2 * (rect.y + rect.height)) / pass.height,
    ],
    uvScale: [rect.width / target.width, rect.height / target.height],
  };
}

/**
 * Creates the layer composite pipeline: `layer-composite.wgsl` blending a render
 * target's premultiplied colour source-over (`premultiplied`) into the pass, with group 0 holding
 * the uniform (binding 0), the target's texture (1) and its sampler (2).
 *
 * @param backend - The backend to compile it on.
 * @returns The pipeline; its owner destroys it.
 */
export function createLayerCompositePipeline(backend: GpuBackend): GpuRenderPipeline {
  return backend.createRenderPipeline({
    label: 'layer-composite',
    shader: LAYER_COMPOSITE_SHADER,
    vertexBuffers: LAYER_COMPOSITE_VERTEX_BUFFERS,
    bindings: LAYER_COMPOSITE_BINDINGS,
    blend: 'premultiplied',
  });
}

/**
 * The composite's uniform: the opacity, whether to flip rows, the target's drawn part and the
 * rectangle in clip space (default the whole viewport and target). Pure.
 *
 * @param opacity - The layer's opacity, in [0, 1].
 * @param isBottomUp - Whether the target's rows run bottom to top (WebGL2).
 * @param placement - Where it lands (`layerCompositePlacement`); default the whole viewport.
 * @param out - Eight floats to write it into (a frame's composites reuse one);
 *   default a new array.
 * @returns The uniform's eight floats: `out` when given.
 */
export function layerCompositeUniform(
  opacity: number,
  isBottomUp: boolean,
  placement: LayerCompositePlacement = WHOLE_VIEWPORT,
  out: Float32Array<ArrayBuffer> = new Float32Array(LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH / 4),
): Float32Array<ArrayBuffer> {
  const [uvX, uvY] = placement.uvScale;
  const [left, top, right, bottom] = placement.clip;
  out[0] = opacity;
  out[1] = isBottomUp ? 1 : 0;
  out[2] = uvX;
  out[3] = uvY;
  out[4] = left;
  out[5] = top;
  out[6] = right;
  out[7] = bottom;
  return out;
}

/**
 * Checks a composite's rectangle and opacity. The rectangle becomes the pass's viewport, so its
 * edges are whole device pixels, its origin is on the canvas and its size is the target's. Pure.
 *
 * @param target - The target to composite.
 * @param rect - Where it lands, in device pixels from the canvas's top-left corner.
 * @param opacity - The opacity.
 * @throws {RangeError} When the rectangle is not whole, non-negative pixels the target's size, or
 *   the opacity is not in [0, 1].
 */
export function assertLayerComposite(
  target: GpuRenderTarget,
  rect: GpuViewport,
  opacity: number,
): void {
  const { x, y, width, height } = rect;
  if (![x, y].every((edge) => Number.isSafeInteger(edge) && edge >= 0)) {
    throw new RangeError(
      `A composite's origin is whole, non-negative device pixels; received (${String(x)}, ${String(y)}).`,
    );
  }
  if (width !== target.width || height !== target.height) {
    throw new RangeError(
      `A composite is drawn at its target's size, ${String(target.width)} × ${String(target.height)}; received ${String(width)} × ${String(height)}.`,
    );
  }
  if (!(opacity >= 0 && opacity <= 1)) {
    throw new RangeError(`An opacity is in [0, 1]; received ${String(opacity)}.`);
  }
}

/** What one backend's composites share: compiled once, kept as long as the backend. */
export interface CompositeResources {
  readonly pipeline: GpuRenderPipeline;
  readonly corners: GpuBuffer;
  readonly uniform: GpuBuffer;
  readonly sampler: GpuSampler;
}

const resourcesByBackend = new WeakMap<GpuBackend, CompositeResources>();

/**
 * One backend's shared composite pipeline, unit quad, uniform (for `drawLayerComposite`) and
 * nearest sampler, made on first use and kept as long as the backend.
 *
 * @param backend - The backend.
 * @returns Its resources.
 */
export function layerCompositeResources(backend: GpuBackend): CompositeResources {
  let resources = resourcesByBackend.get(backend);
  if (resources === undefined) {
    const corners = backend.createBuffer({
      usage: 'vertex',
      byteLength: QUAD_CORNERS.byteLength,
      label: 'layer-composite corners',
    });
    backend.writeBuffer(corners, 0, QUAD_CORNERS);
    resources = {
      pipeline: createLayerCompositePipeline(backend),
      corners,
      uniform: backend.createBuffer({
        usage: 'uniform',
        byteLength: LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH,
        label: 'layer-composite uniform',
      }),
      // The target is drawn at its own size, so each fragment reads exactly its texel.
      sampler: backend.createSampler({
        filter: 'nearest',
        addressMode: 'clamp-to-edge',
        label: 'layer-composite',
      }),
    };
    resourcesByBackend.set(backend, resources);
  }
  return resources;
}

/**
 * Draws a render target into the canvas at a device rectangle and an opacity, in its
 * own pass that loads what earlier passes drew: premultiplied source-over, so the target's
 * contents fade as one layer. The pipeline, quad, uniform and sampler are made on the first call
 * per backend and kept with it; the backend's `destroy()` frees them. No pass may be open.
 *
 * @param backend - The backend that made `target`.
 * @param target - The target, after a pass to it has ended.
 * @param rect - Where it lands: whole device pixels on the canvas, the target's size.
 * @param opacity - The layer's opacity, in [0, 1].
 * @throws {RangeError} When the rectangle or opacity is invalid (`assertLayerComposite`).
 */
export function drawLayerComposite(
  backend: GpuBackend,
  target: GpuRenderTarget,
  rect: GpuViewport,
  opacity: number,
): void {
  assertLayerComposite(target, rect, opacity);
  const { pipeline, corners, uniform, sampler } = layerCompositeResources(backend);
  const isBottomUp = isRenderTargetBottomUp(backend.capabilities.backendName);
  backend.writeBuffer(uniform, 0, layerCompositeUniform(opacity, isBottomUp));
  const bindGroup = backend.createBindGroup({
    pipeline,
    entries: [
      { binding: 0, buffer: uniform },
      { binding: 1, texture: target.texture },
      { binding: 2, sampler },
    ],
  });
  const pass = backend.beginRenderPass({});
  pass.setViewport(rect);
  pass.setPipeline(pipeline);
  pass.setBindGroup(bindGroup);
  pass.setVertexBuffer(0, corners);
  pass.draw(6);
  pass.end();
}

/**
 * Records one composite into a pass that is already open: the canvas pass or a
 * parent layer's target pass. Its bind group holds a uniform written before the pass opened
 * (`layerCompositeUniform` with a `layerCompositePlacement`), the target's texture and the shared
 * sampler; the pass's viewport is left as it is.
 *
 * @param renderPass - The open pass.
 * @param resources - The backend's composite resources (`layerCompositeResources`).
 * @param bindGroup - The layer's bind group.
 * @param firstInstance - The composite record's slot: the pipeline reads no instance data, so it
 *   only names the layer to whoever records the draw. Default 0.
 */
export function recordLayerComposite(
  renderPass: GpuRenderPass,
  resources: CompositeResources,
  bindGroup: GpuBindGroup,
  firstInstance = 0,
): void {
  renderPass.setPipeline(resources.pipeline);
  renderPass.setBindGroup(bindGroup);
  renderPass.setVertexBuffer(0, resources.corners);
  renderPass.draw(6, 1, 0, firstInstance);
}
