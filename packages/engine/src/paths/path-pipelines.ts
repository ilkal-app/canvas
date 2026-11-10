import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuColorWrite, GpuRenderPipeline, GpuStencilState } from '../gpu/gpu-pipeline.js';
import { MOVE_INDEX_LAYOUT, type MovePlacementBinding } from '../gpu/move-placement.js';
import { CLIP_TABLE_BINDING, type ClipTableTexture } from '../scene/clip-table-texture.js';
import type { InstanceLayout } from '../scene/instance-layout.js';
import type { ScenePipelineSpec } from '../scene/scene-pass.js';

/**
 * The fixed-function states the path pass draws with (the prototype's
 * `PathRenderer.drawRange`, `webgl-whiteboard/src/render/pathRenderer.ts`):
 *
 * - `fillStencil`: the fill's fans, colour off, inverting the stencil, so the loops' even-odd
 *   count is left set;
 * - `fillCover`: the cover quad where the stencil is set, painting and zeroing it for the next
 *   path;
 * - `stroke`: an opaque stroke's triangles straight into colour (their overlaps at joins do
 *   not show);
 * - `strokeOnce`: a translucent stroke's triangles where the stencil is clear, setting it, so
 *   each pixel is painted once however many triangles overlap there;
 * - `stencilClear`: the cover quad, colour off, zeroing what `strokeOnce` set.
 */
export interface PathPipelines {
  /** The fans into the stencil. */
  readonly fillStencil: GpuRenderPipeline;
  /** The fill's cover quad. */
  readonly fillCover: GpuRenderPipeline;
  /** An opaque stroke. */
  readonly stroke: GpuRenderPipeline;
  /** A translucent stroke, each pixel once. */
  readonly strokeOnce: GpuRenderPipeline;
  /** Zeroes the stencil under the cover quad. */
  readonly stencilClear: GpuRenderPipeline;
  /**
   * The camera bind group (with the spec's page bindings, for the gradient variant: the paint
   * table, and the clip table at binding 5; rebuilt when either texture is). Every pipeline declares the same group-0 layout, so it
   * stays valid across their switches (WebGPU's group-equivalent layouts; one uniform binding on
   * WebGL2).
   */
  readonly bindGroup: GpuBindGroup;
}

/** A pipeline's colour writes and stencil test. */
interface PipelineState {
  readonly colorWrite: GpuColorWrite;
  readonly stencil?: GpuStencilState;
}

const NO_ENTRIES: readonly GpuBindGroupEntry[] = Object.freeze([]);

const STATES: Readonly<Record<Exclude<keyof PathPipelines, 'bindGroup'>, PipelineState>> = {
  fillStencil: { colorWrite: 'none', stencil: { compare: 'always', passOperation: 'invert' } },
  fillCover: { colorWrite: 'all', stencil: { compare: 'not-equal', passOperation: 'zero' } },
  stroke: { colorWrite: 'all' },
  strokeOnce: { colorWrite: 'all', stencil: { compare: 'equal', passOperation: 'invert' } },
  stencilClear: { colorWrite: 'none', stencil: { compare: 'not-equal', passOperation: 'zero' } },
};

/**
 * Creates the path pass's pipelines on a backend: one shader (`path.wgsl`), the mesh at vertex
 * slot 0 and the layer records at slot 1, five fixed-function states.
 *
 * @param backend - The backend.
 * @param spec - The pass's pipeline spec: shader, per-vertex layout, blending.
 * @param layout - The pass's record layout.
 * @param cameraBuffer - The camera uniform buffer, bound at binding 0.
 * @param clipTable - The scene's clip table, bound at binding 5.
 * @param label - A label prefix for GPU debuggers.
 * @param placement - Optional retained placement table; the spec must opt in with a move shader.
 * @param pages - The pass, whose `pageEntries(0)` give the resources of the spec's `pageBindings`
 *   (the gradient variant's paint table), asked each time the bind group is read; the same array
 *   keeps the bind group. Default none.
 * @param pages.pageEntries - The pass's page resources.
 * @returns The pipelines and their bind group.
 * @throws {Error} When retained placement is requested without a move shader.
 */
export function createPathPipelines(
  backend: GpuBackend,
  spec: ScenePipelineSpec,
  layout: InstanceLayout,
  cameraBuffer: GpuBuffer,
  clipTable: ClipTableTexture,
  label: string,
  placement?: MovePlacementBinding,
  pages: { readonly pageEntries?: (page: number) => readonly GpuBindGroupEntry[] } = {},
): PathPipelines {
  if (placement && spec.moveShader === undefined) {
    throw new Error('The path pipeline has not opted in to retained placement.');
  }
  const create = (name: string, state: PipelineState): GpuRenderPipeline =>
    backend.createRenderPipeline({
      shader: placement === undefined ? spec.shader : (spec.moveShader ?? spec.shader),
      vertexBuffers: [
        spec.vertexLayout,
        layout.vertexBufferLayout,
        ...(placement ? [MOVE_INDEX_LAYOUT] : []),
      ],
      bindings: [
        { binding: 0, kind: 'uniform-buffer' },
        ...(spec.pageBindings ?? []),
        ...(placement ? [{ binding: 4, kind: 'load-texture' as const }] : []),
        { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
      ],
      blend: spec.blend,
      colorWrite: state.colorWrite,
      ...(state.stencil ? { stencil: state.stencil } : {}),
      label: `${label} ${name}`,
    });
  const fillStencil = create('fill stencil', STATES.fillStencil);
  const build = (entries: readonly GpuBindGroupEntry[]): GpuBindGroup =>
    backend.createBindGroup({
      pipeline: fillStencil,
      entries: [
        { binding: 0, buffer: cameraBuffer },
        ...entries,
        ...(placement ? [{ binding: 4, texture: placement.table.texture }] : []),
        { binding: CLIP_TABLE_BINDING, texture: clipTable.texture },
      ],
      label: `${label} camera`,
    });
  // Built on first use and again when the paint table's texture (the page entries) or the clip
  // table's texture is replaced.
  let entries = NO_ENTRIES;
  let clipTexture = clipTable.texture;
  let bindGroup: GpuBindGroup | undefined;
  return {
    fillStencil,
    fillCover: create('fill cover', STATES.fillCover),
    stroke: create('stroke', STATES.stroke),
    strokeOnce: create('stroke once', STATES.strokeOnce),
    stencilClear: create('stencil clear', STATES.stencilClear),
    get bindGroup(): GpuBindGroup {
      const current = pages.pageEntries?.(0) ?? NO_ENTRIES;
      if (bindGroup === undefined || current !== entries || clipTexture !== clipTable.texture) {
        entries = current;
        clipTexture = clipTable.texture;
        bindGroup = build(current);
      }
      return bindGroup;
    },
  };
}

/**
 * Frees the pipelines.
 *
 * @param pipelines - The pipelines.
 */
export function destroyPathPipelines(pipelines: PathPipelines): void {
  pipelines.fillStencil.destroy();
  pipelines.fillCover.destroy();
  pipelines.stroke.destroy();
  pipelines.strokeOnce.destroy();
  pipelines.stencilClear.destroy();
}
