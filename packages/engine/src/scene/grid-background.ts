import type { Rgba } from '@canvas/schema';

import { isSameCamera, type Camera } from '../camera/camera.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';
import { DOT_GRID_SHADER } from '../gpu/shaders/dot-grid.generated.js';

import type { DrawStageBackground } from './draw-stage-background.js';
import type { FrameContext } from './frame-context.js';
import { gridOpacityAt } from './grid-fade.js';
import { gridSpacingAt } from './grid-spacing.js';

/**
 * The dots' colour, straight alpha: a mid grey at half strength, which reads on the light and
 * the dark canvas alike (the engine host clears to transparent over the theme's background).
 */
export const GRID_DOT_COLOR: Rgba = [0.5, 0.5, 0.5, 0.5];

/** A dot's radius, CSS px, whatever the zoom. */
export const GRID_DOT_RADIUS_PX = 1;

/** The grid uniform's size: `phase`, `size`, `color`, `spacing`, `radius`, padding; 48 bytes. */
export const GRID_UNIFORM_BYTE_LENGTH = 48;

/** The whole canvas as two triangles, corners in [0, 1]², y down. */
const CANVAS_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/** How a {@link GridBackground} looks. */
export interface GridBackgroundOptions {
  /** The dots' straight-alpha colour; {@link GRID_DOT_COLOR} if absent. */
  readonly color?: Rgba;
  /** A dot's radius, CSS px; {@link GRID_DOT_RADIUS_PX} if absent. */
  readonly dotRadiusPx?: number;
  /** Whether the grid shows from the start; false if absent. */
  readonly isVisible?: boolean;
}

/**
 * Where `value` falls in `[0, period)`, whatever its sign.
 *
 * @param value - The value.
 * @param period - The period, positive.
 * @returns The remainder.
 */
function wrap(value: number, period: number): number {
  const remainder = value % period;
  // `+ 0` turns a negative zero (the origin itself) into zero.
  return remainder < 0 ? remainder + period : remainder + 0;
}

/**
 * The dot grid's uniform for a camera, in device pixels (the layout of `Grid` in
 * `dot-grid.wgsl`): the lattice's phase (where the world origin's dot falls, reduced modulo the
 * spacing in world units first, so a far pan keeps full precision), the canvas's size, the
 * colour with its alpha scaled by the zoom fade ({@link gridOpacityAt}), the spacing ({@link gridSpacingAt} at the camera's zoom, times zoom and dpr) and the
 * dot's radius. Pure.
 *
 * @param camera - The frame's camera.
 * @param color - The dots' straight-alpha colour.
 * @param dotRadiusPx - A dot's radius, CSS px.
 * @param out - Where to write the twelve floats; a new array if absent.
 * @returns `out`, filled.
 */
export function dotGridUniformOf(
  camera: Camera,
  color: Rgba,
  dotRadiusPx: number,
  out: Float32Array<ArrayBuffer> = new Float32Array(GRID_UNIFORM_BYTE_LENGTH / 4),
): Float32Array<ArrayBuffer> {
  const pxPerWorld = camera.zoom * camera.dpr;
  const spacing = gridSpacingAt(camera.zoom);
  out[0] = wrap(-camera.x, spacing) * pxPerWorld;
  out[1] = wrap(-camera.y, spacing) * pxPerWorld;
  out[2] = camera.viewportWidthPx * camera.dpr;
  out[3] = camera.viewportHeightPx * camera.dpr;
  out.set(color, 4);
  out[7] = color[3] * gridOpacityAt(camera.zoom);
  out[8] = spacing * pxPerWorld;
  out[9] = dotRadiusPx * camera.dpr;
  out[10] = 0;
  out[11] = 0;
  return out;
}

/**
 * The dot grid behind the board: the `draw`
 * stage's background (`createDrawStage`), one full-canvas quad drawn first in the scene's
 * render pass, so every object is over it. Its fragment shader lights the pixels within a
 * dot's radius of the lattice, in device pixels, with the zoom-adaptive spacing of
 * {@link gridSpacingAt}, so dots stay 16–32 CSS px apart and one screen size at every zoom.
 * The cost is the camera's alone: a 48-byte uniform written when the camera (or visibility)
 * changes, and one draw of six vertices; a hidden grid writes and draws nothing. Zooming out,
 * the dots fade ({@link gridOpacityAt}) and below the fade band the grid writes and draws
 * nothing either, while it stays shown. Runs on the thread that owns the backend.
 */
export class GridBackground implements DrawStageBackground {
  private readonly backend: GpuBackend;
  private readonly pipeline: GpuRenderPipeline;
  private readonly bindGroup: GpuBindGroup;
  private readonly uniform: GpuBuffer;
  private readonly vertices: GpuBuffer;
  private readonly color: Rgba;
  private readonly dotRadiusPx: number;
  /** The uniform's values, rewritten in place: a frame allocates nothing. */
  private readonly values = new Float32Array(GRID_UNIFORM_BYTE_LENGTH / 4);
  /** The camera the uniform was last written for. */
  private writtenCamera: Camera | undefined;
  private isShown: boolean;

  /**
   * Creates the grid's pipeline and buffers.
   *
   * @param backend - The backend the scene draws through.
   * @param options - Colour, dot radius and whether it starts visible.
   */
  constructor(backend: GpuBackend, options: GridBackgroundOptions = {}) {
    this.backend = backend;
    this.color = options.color ?? GRID_DOT_COLOR;
    this.dotRadiusPx = options.dotRadiusPx ?? GRID_DOT_RADIUS_PX;
    this.isShown = options.isVisible ?? false;
    this.pipeline = backend.createRenderPipeline({
      shader: DOT_GRID_SHADER,
      vertexBuffers: [{ stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] }],
      bindings: [{ binding: 0, kind: 'uniform-buffer' }],
      blend: 'premultiplied',
      label: 'dot-grid',
    });
    this.uniform = backend.createBuffer({
      usage: 'uniform',
      byteLength: GRID_UNIFORM_BYTE_LENGTH,
      label: 'dot-grid uniform',
    });
    this.bindGroup = backend.createBindGroup({
      pipeline: this.pipeline,
      entries: [{ binding: 0, buffer: this.uniform }],
      label: 'dot-grid',
    });
    this.vertices = backend.createBuffer({
      usage: 'vertex',
      byteLength: CANVAS_QUAD.byteLength,
      label: 'dot-grid vertices',
    });
    backend.writeBuffer(this.vertices, 0, CANVAS_QUAD);
  }

  /**
   * Whether the grid is drawn.
   *
   * @returns True while it shows.
   */
  get isVisible(): boolean {
    return this.isShown;
  }

  /**
   * Shows or hides the grid from the next frame on.
   *
   * @param isVisible - Whether it shows.
   */
  setVisible(isVisible: boolean): void {
    this.isShown = isVisible;
  }

  /**
   * Writes the uniform when the camera moved since it was last written, into the same array;
   * nothing while hidden or zoomed out below the fade band, and no allocation when the camera is unchanged.
   *
   * @param context - The frame's context.
   */
  prepare(context: FrameContext): void {
    if (!this.isDrawnAt(context.camera)) return;
    const { camera } = context;
    if (this.writtenCamera !== undefined && isSameCamera(this.writtenCamera, camera)) return;
    dotGridUniformOf(camera, this.color, this.dotRadiusPx, this.values);
    this.backend.writeBuffer(this.uniform, 0, this.values);
    this.writtenCamera = camera;
    context.stats.bufferWrites += 1;
    context.stats.uploadedBytes += this.values.byteLength;
  }

  /**
   * Draws the dots over the whole canvas, under everything else; nothing while hidden or zoomed
   * out below the fade band.
   *
   * @param renderPass - The `draw` stage's pass, just cleared.
   * @param context - The frame's context.
   */
  draw(renderPass: GpuRenderPass, context: FrameContext): void {
    if (!this.isDrawnAt(context.camera)) return;
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertices);
    renderPass.draw(CANVAS_QUAD.length / 2);
    context.stats.drawCalls += 1;
  }

  /**
   * Whether a frame with this camera draws the grid: shown, and zoomed in past the fade band's
   * foot.
   *
   * @param camera - The frame's camera.
   * @returns True when the frame writes and draws the grid.
   */
  private isDrawnAt(camera: Camera): boolean {
    return this.isShown && gridOpacityAt(camera.zoom) > 0;
  }

  /** Frees the grid's buffers and pipeline; the backend stays alive. */
  destroy(): void {
    this.uniform.destroy();
    this.vertices.destroy();
    this.pipeline.destroy();
  }
}
