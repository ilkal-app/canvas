import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';
import type { GpuShaderSource } from '../gpu/gpu-shader.js';
import type { MovePlacementBinding } from '../gpu/move-placement.js';

import type { CameraUniform } from './camera-uniform.js';
import { CLIP_TABLE_BINDING, ClipTableTexture } from './clip-table-texture.js';
import type { DrawListEntry } from './draw-list.js';
import type { FrameContext, FrameStats } from './frame-context.js';
import type { InstanceBuffer } from './instance-buffer.js';
import { MoveInstancedDraw } from './move-instanced-draw.js';
import { pageVariantPipelineLabel } from './pass-pipeline-label.js';
import type { InstanceRange } from './scene-culler.js';
import type { ScenePassDrawer } from './scene-pass-drawer.js';
import type { ScenePass } from './scene-pass.js';
import type { Scene } from './scene.js';

/** The pipeline and per-vertex geometry of a pass's instanced draws. */
interface InstancedDraw {
  readonly pipeline: GpuRenderPipeline;
  /** The `pageShaderVariants` pipelines, fewest slots first. */
  readonly variants: readonly {
    readonly pageSlots: number;
    readonly pipeline: GpuRenderPipeline;
  }[];
  /** Whether the pass binds one group per page (`pageBindings`) rather than one for all. */
  readonly isPaged: boolean;
  readonly vertexBuffer: GpuBuffer;
}

/** A page's bind group and the resources it was built from. */
interface PageBindGroup {
  readonly entries: readonly GpuBindGroupEntry[];
  readonly bindGroup: GpuBindGroup;
}

/**
 * Whether two entry lists bind the same resources at the same bindings.
 *
 * @param first - One list.
 * @param second - The other.
 * @returns Whether they are equal entry by entry.
 */
function isSameEntries(
  first: readonly GpuBindGroupEntry[],
  second: readonly GpuBindGroupEntry[],
): boolean {
  if (first.length !== second.length) return false;
  return first.every((entry, index) => {
    const other = second[index];
    if (other?.binding !== entry.binding) return false;
    if ('buffer' in entry) return 'buffer' in other && other.buffer === entry.buffer;
    if ('texture' in entry) return 'texture' in other && other.texture === entry.texture;
    return 'sampler' in other && other.sampler === entry.sampler;
  });
}

/**
 * One scene pass's GPU side: its pipeline, the camera bind group (or, for a paged pass, one bind
 * group per page: the camera plus the page's resources), the per-vertex geometry and the GPU
 * copy of its persistent instance buffer, which it keeps in step with the CPU copy by uploading
 * dirty ranges. A custom-draw pass (`ScenePass.createDrawer`) has its
 * drawer instead of the pipeline, bind groups and geometry. Created once per pass by the scene
 * renderer.
 */
export class ScenePassResources {
  /** The pass. */
  readonly pass: ScenePass;
  /** The CPU copy of the pass's instance buffer (the scene's). */
  readonly instances: InstanceBuffer;
  /** The pass's drawer when it is a custom-draw pass, else `undefined`. */
  readonly drawer: ScenePassDrawer | undefined;
  private readonly backend: GpuBackend;
  private instanced: InstancedDraw | undefined;
  private movePlacement: MovePlacementBinding | undefined;
  private readonly cameraUniform: CameraUniform;
  private readonly clipTable: ClipTableTexture;
  private readonly isClipTableOwned: boolean;
  private readonly pageBindGroups = new Map<number, PageBindGroup>();
  private instanceBuffer: GpuBuffer;
  private moveDraw: MoveInstancedDraw | undefined;

  /**
   * Builds the pass's pipeline and buffers and uploads its per-vertex geometry (a deferred pass's
   * pipeline and geometry wait for its first record: `ScenePipelineSpec.isDeferred`), or creates
   * its drawer for a custom-draw pass.
   *
   * @param backend - The backend to draw through.
   * @param pass - The pass.
   * @param instances - The pass's CPU instance buffer.
   * @param cameraUniform - The camera uniform, bound at binding 0.
   * @param clipTable - The scene's clip table, bound at binding 5. Absent, for passes
   *   drawn outside a scene (overlays), the resources keep a table of one unclipped slot.
   */
  constructor(
    backend: GpuBackend,
    pass: ScenePass,
    instances: InstanceBuffer,
    cameraUniform: CameraUniform,
    clipTable?: ClipTableTexture,
  ) {
    this.backend = backend;
    this.pass = pass;
    this.instances = instances;
    this.cameraUniform = cameraUniform;
    this.isClipTableOwned = clipTable === undefined;
    this.clipTable = clipTable ?? new ClipTableTexture(backend);
    this.drawer = pass.createDrawer?.({
      backend,
      passName: pass.name,
      instances,
      cameraUniform,
      clipTable: this.clipTable,
    });
    this.instanced =
      this.drawer || pass.pipelineSpec.isDeferred === true
        ? undefined
        : createInstancedDraw(backend, pass);
    this.instanceBuffer = this.createInstanceBuffer();
  }

  /**
   * Selects a retained placement variant without changing ordinary record layout or bytes.
   *
   * @param placement - Borrowed move resources, or undefined to restore ordinary drawing.
   */
  setMovePlacement(placement: MovePlacementBinding | undefined): void {
    this.moveDraw?.destroy();
    this.moveDraw = undefined;
    this.movePlacement = placement;
    if (this.drawer) this.drawer.setMovePlacement?.(placement);
    else this.buildMoveDraw();
  }

  /**
   * Whether the pass's instanced pipeline exists (a deferred one's waits for a record).
   *
   * @returns True once it is built; false for a custom-draw pass.
   */
  get hasPipeline(): boolean {
    return this.instanced !== undefined;
  }

  /**
   * Brings the GPU instance buffer up to date and clears the CPU buffer's dirty ranges. Each
   * dirty range is one `writeBuffer`; a clean buffer writes nothing. When the CPU buffer has
   * grown, the GPU buffer is replaced and its used records `[0, recordCount)` are written once.
   * Call with no render pass open.
   *
   * @param stats - The frame's counters, to add the writes to.
   */
  upload(stats: FrameStats): void {
    const { instances } = this;
    if (!this.drawer && this.instanced === undefined && instances.recordCount > 0) {
      this.instanced = createInstancedDraw(this.backend, this.pass);
      this.buildMoveDraw();
    }
    if (this.instanceBuffer.byteLength !== instances.byteLength) {
      this.instanceBuffer.destroy();
      this.instanceBuffer = this.createInstanceBuffer();
      this.write(0, instances.recordCount * instances.layout.byteStride, stats);
    } else {
      for (const [start, end] of instances.dirtyRanges) this.write(start, end, stats);
    }
    instances.clearDirty();
  }

  /**
   * Draws instance ranges of the pass: one instanced draw per non-empty range, a paged pass's
   * with the bind group of the ranges' page.
   *
   * @param renderPass - The open render pass.
   * @param ranges - The ranges to draw, from the cull stage.
   * @param stats - The frame's counters, to add the draws to.
   * @param page - The page the ranges sample, for a paged pass; default 0.
   * @throws {Error} When the pass is paged but has no `pageEntries`.
   */
  draw(
    renderPass: GpuRenderPass,
    ranges: readonly InstanceRange[],
    stats: FrameStats,
    page = 0,
  ): void {
    if (this.moveDraw) {
      this.moveDraw.draw(renderPass, ranges, stats, page, this.instanceBuffer);
      return;
    }
    const { instanced } = this;
    if (!instanced || !ranges.some((range) => range.count > 0)) return;
    const variant = this.variantOf(instanced, page);
    renderPass.setPipeline(instanced.variants[variant]?.pipeline ?? instanced.pipeline);
    renderPass.setBindGroup(this.bindGroupOf(instanced, page, variant));
    renderPass.setVertexBuffer(0, instanced.vertexBuffer);
    renderPass.setVertexBuffer(1, this.instanceBuffer);
    for (const { start, count } of ranges) {
      if (count <= 0) continue;
      renderPass.draw(this.pass.pipelineSpec.vertexCount, count, 0, start);
      stats.drawCalls += 1;
    }
  }

  /**
   * Draws one draw-list entry: through the drawer for a custom-draw pass, else one instanced
   * draw per range.
   *
   * @param renderPass - The open render pass.
   * @param entry - The entry, one of this pass's.
   * @param context - The frame; its stats count the draws.
   */
  drawEntry(renderPass: GpuRenderPass, entry: DrawListEntry, context: FrameContext): void {
    if (this.drawer) {
      this.drawer.drawEntry(
        { frame: context, renderPass, instanceBuffer: this.instanceBuffer },
        entry,
      );
    } else {
      this.draw(renderPass, entry.ranges, context.stats, entry.page);
    }
  }

  /** Frees the pass's buffers and pipeline, or its drawer. */
  destroy(): void {
    this.moveDraw?.destroy();
    this.instanceBuffer.destroy();
    this.drawer?.destroy();
    this.instanced?.vertexBuffer.destroy();
    this.instanced?.pipeline.destroy();
    for (const { pipeline } of this.instanced?.variants ?? []) pipeline.destroy();
    if (this.isClipTableOwned) this.clipTable.destroy();
  }

  /**
   * A page's bind group (page 0 for a pass that is not paged): the camera at binding 0, the
   * pass's entries for the page and the clip table at binding 5, rebuilt when the pass names
   * other resources for it or the clip table's texture is replaced.
   *
   * @param instanced - The pass's pipeline.
   * @param page - The page.
   * @param variant - The page's `pageShaderVariants` index, or -1 for the pass's shader.
   * @returns The bind group.
   * @throws {Error} When the pass is paged but has no `pageEntries`.
   */
  private bindGroupOf(instanced: InstancedDraw, page: number, variant: number): GpuBindGroup {
    if (instanced.isPaged && this.pass.pageEntries === undefined) {
      throw new Error(`Scene pass "${this.pass.name}" declares page bindings but no pageEntries.`);
    }
    const entries: readonly GpuBindGroupEntry[] = [
      ...(instanced.isPaged ? (this.pass.pageEntries?.(page) ?? []) : []),
      { binding: CLIP_TABLE_BINDING, texture: this.clipTable.texture },
    ];
    // One bind group per page and pipeline: a group belongs to the pipeline it was made for.
    const key = (instanced.isPaged ? page : 0) * (instanced.variants.length + 1) + variant + 1;
    const cached = this.pageBindGroups.get(key);
    if (cached !== undefined && isSameEntries(cached.entries, entries)) return cached.bindGroup;
    const bindGroup = this.backend.createBindGroup({
      pipeline: instanced.variants[variant]?.pipeline ?? instanced.pipeline,
      entries: [{ binding: 0, buffer: this.cameraUniform.buffer }, ...entries],
      label: instanced.isPaged
        ? `${this.pass.name} page ${String(page)}`
        : `${this.pass.name} camera`,
    });
    this.pageBindGroups.set(key, { entries, bindGroup });
    return bindGroup;
  }

  /**
   * The `pageShaderVariants` index a page draws with: the first whose slots cover the pass's
   * `pageSlotsOf(page)`, or -1 for the pass's shader.
   *
   * @param instanced - The pass's pipelines.
   * @param page - The page.
   * @returns The index.
   */
  private variantOf(instanced: InstancedDraw, page: number): number {
    if (instanced.variants.length === 0 || this.pass.pageSlotsOf === undefined) return -1;
    const slots = this.pass.pageSlotsOf(page);
    return instanced.variants.findIndex(({ pageSlots }) => pageSlots >= slots);
  }

  /** Builds the move variant of the instanced draw for the current placement, if both exist. */
  private buildMoveDraw(): void {
    if (!this.movePlacement || !this.instanced) return;
    this.moveDraw = new MoveInstancedDraw(
      this.backend,
      this.pass,
      { camera: this.cameraUniform, clipTable: this.clipTable },
      this.movePlacement,
      this.instanced.vertexBuffer,
    );
  }

  private createInstanceBuffer(): GpuBuffer {
    return this.backend.createBuffer({
      usage: 'vertex',
      byteLength: this.instances.byteLength,
      label: `${this.pass.name} instances`,
    });
  }

  private write(start: number, end: number, stats: FrameStats): void {
    if (end <= start) return;
    const data = this.instances.data.subarray(
      start / Float32Array.BYTES_PER_ELEMENT,
      end / Float32Array.BYTES_PER_ELEMENT,
    );
    this.backend.writeBuffer(this.instanceBuffer, start, data);
    stats.bufferWrites += 1;
    stats.uploadedBytes += end - start;
  }
}

/**
 * Builds a pass's instanced pipeline (the camera at binding 0, its page bindings, the clip
 * table at binding 5) and its per-vertex geometry, and uploads the geometry.
 *
 * @param backend - The backend.
 * @param pass - The pass.
 * @returns The pipeline and vertex buffer.
 */
function createInstancedDraw(backend: GpuBackend, pass: ScenePass): InstancedDraw {
  const spec = pass.pipelineSpec;
  const pipelineOf = (shader: GpuShaderSource, label: string): GpuRenderPipeline =>
    backend.createRenderPipeline({
      shader,
      vertexBuffers: [spec.vertexLayout, pass.layout.vertexBufferLayout],
      bindings: [
        { binding: 0, kind: 'uniform-buffer' },
        ...(spec.pageBindings ?? []),
        { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
      ],
      blend: spec.blend,
      label,
    });
  const pipeline = pipelineOf(spec.shader, pass.name);
  const variants = (spec.pageShaderVariants ?? []).map(({ pageSlots, shader }) => ({
    pageSlots,
    pipeline: pipelineOf(shader, pageVariantPipelineLabel(pass.name, pageSlots)),
  }));
  const vertexBuffer = backend.createBuffer({
    usage: 'vertex',
    byteLength: spec.vertices.byteLength,
    label: `${pass.name} vertices`,
  });
  backend.writeBuffer(vertexBuffer, 0, spec.vertices);
  return { pipeline, variants, isPaged: spec.pageBindings !== undefined, vertexBuffer };
}

/**
 * Creates the GPU resources of every pass of a scene, sharing the camera uniform and the clip
 * table (the `SceneRenderer`'s).
 *
 * @param backend - The backend.
 * @param scene - The scene: its passes and their instance buffers.
 * @param cameraUniform - The camera uniform, bound at binding 0.
 * @param clipTable - The scene's clip table, bound at binding 5.
 * @returns The resources, in pass order.
 */
export function createScenePassResources(
  backend: GpuBackend,
  scene: Pick<Scene, 'passes' | 'instanceBufferOf'>,
  cameraUniform: CameraUniform,
  clipTable: ClipTableTexture,
): ScenePassResources[] {
  return scene.passes.map(
    (pass) =>
      new ScenePassResources(
        backend,
        pass,
        scene.instanceBufferOf(pass.name),
        cameraUniform,
        clipTable,
      ),
  );
}
