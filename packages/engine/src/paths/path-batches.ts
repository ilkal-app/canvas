// Batched opaque path strokes: a run of consecutive opaque stroke layers in a draw-list
// entry draws as one draw of a batch buffer, (x, y, record slot) per vertex, whose vertices read
// their own records from the path record texture (path-batch.wgsl). Fills and translucent strokes
// keep the per-path stencil sequence (PathLayerDraws), in place, so the paint order is unchanged.
import type { ObjectId } from '@canvas/schema';

import type { MovePlacementBinding } from '../gpu/move-placement.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { EntryDrawContext, ScenePassDrawerSetup } from '../scene/scene-pass-drawer.js';

import type { GpuPathMesh } from './gpu-path-mesh.js';
import { PathBatchPipelines } from './path-batch-pipelines.js';
import {
  BatchPlanner,
  isPlanCurrent,
  type BatchRun,
  type HeldStrokes,
  type PlannedEntry,
  type PlanSources,
} from './path-batch-plan.js';
import { sameRanges } from './path-draw-cache.js';
import type { PathDrawerOptions } from './path-drawer-options.js';
import { PathLayerDraws } from './path-layer-draws.js';
import { PATH_MESH_PAGE_BYTES } from './path-mesh-arena.js';
import type { PathPipelines } from './path-pipelines.js';
import { PathRecordTexture } from './path-record-texture.js';
import type { PathRegistry } from './path-registry.js';

/** What the batches read of their drawer. */
export interface PathBatchesSetup extends PlanSources {
  /** The batched pipelines. */
  readonly pipelines: PathBatchPipelines;
}

/** How much planning and texel syncing the batches have done, since they were created. */
export interface PathBatchCounts {
  /** Plans built (not kept). */
  readonly plans: number;
  /** Slots whose record texels were compared with their records. */
  readonly syncedSlots: number;
}

/**
 * Plans each frame's batches before the render pass opens (writing the batch buffers and the
 * record texels that changed), and draws them in the pass. A plan is kept while the slots'
 * owners, meshes, opacity and the entries' ranges are unchanged (`isPlanCurrent`), so a frame in
 * which paths only move or recolour re-syncs only the texels of the records it changed (and of
 * every batched slot when a retained move starts or ends); a new plan reuses every batch buffer
 * whose slots and meshes are unchanged.
 */
export class PathBatches {
  /** The path records the batched vertices read. */
  readonly recordTexture: PathRecordTexture;
  private readonly planner: BatchPlanner;
  private plan: PlannedEntry[] = [];
  private isPlanned = false;
  /** This frame's draw-list entries' plans: a layer's entries are drawn once per tile. */
  private readonly byEntry = new Map<DrawListEntry, PlannedEntry>();
  /** The plan's batched slots, 1 each, and in order. */
  private isBatchedBySlot = new Uint8Array(0);
  private batched: number[] = [];
  /** Records written since the last `prepare` (`noteChangedSlots`). */
  private readonly changed = new Set<number>();
  /**
   * The retained move whose indices the texels hold: a new binding re-syncs every batched slot's
   * move index, even one that reuses its predecessor's index array.
   */
  private placed: MovePlacementBinding | undefined;
  private readonly live = { plans: 0, syncedSlots: 0 };
  /** The plan's batched strokes, held through a retained move (`HeldStrokes`). */
  private held: HeldStrokes = new Map();

  /**
   * Creates the record texture; nothing is planned yet.
   *
   * @param setup - The drawer's backend, records, slot owners, meshes and pipelines.
   */
  constructor(private readonly setup: PathBatchesSetup) {
    this.recordTexture = new PathRecordTexture(setup.backend, `${setup.passName} records`);
    this.planner = new BatchPlanner(setup);
  }

  /**
   * The batch buffers' and the record texture's bytes.
   *
   * @returns The bytes.
   */
  get byteLength(): number {
    const { texture } = this.recordTexture;
    return this.planner.byteLength + texture.width * texture.height * 16;
  }

  /**
   * Plans built and slots synced so far, for tests and diagnostics.
   *
   * @returns A copy.
   */
  get counts(): PathBatchCounts {
    return { ...this.live };
  }

  /** Drops the plan (its buffers stay for reuse): the next `prepare` plans again. */
  invalidate(): void {
    this.isPlanned = false;
  }

  /**
   * Notes the records written this frame, before their upload clears them: a kept plan re-syncs
   * only these texels.
   *
   * @param slots - The pass's changed slots (`InstanceBuffer.changedSlots`).
   */
  noteChangedSlots(slots: readonly number[]): void {
    for (const slot of slots) this.changed.add(slot);
  }

  /**
   * Plans the frame's entries of the pass, unless the kept plan still holds, and brings the
   * record texels up to date. Call with no render pass open.
   *
   * @param context - The frame, whose draw list is planned and whose stats count the uploads.
   * @param placement - The retained move, whose indices go into the record texels.
   * @param canKeep - Whether the plan may be kept for later frames (preparation settled).
   */
  prepare(
    context: FrameContext,
    placement: MovePlacementBinding | undefined,
    canKeep: boolean,
  ): void {
    const entries = context.drawList.filter((entry) => entry.passName === this.setup.passName);
    // During a retained move, strokes that leave the viewport keep their batches.
    const held = placement ? this.held : undefined;
    const isKept =
      this.isPlanned &&
      entries.length === this.plan.length &&
      entries.every((entry, index) => isPlanCurrent(this.setup, this.plan[index], entry, held));
    const indexData = placement?.indexData;
    if (!isKept) {
      this.replan(entries, context, held);
      this.sync(this.batched, indexData);
    } else if (placement !== this.placed) {
      this.sync(this.batched, indexData);
    } else if (this.changed.size > 0) {
      const { isBatchedBySlot } = this;
      this.sync(
        [...this.changed].filter((slot) => isBatchedBySlot[slot] === 1),
        indexData,
      );
    }
    this.indexEntries(entries);
    this.changed.clear();
    this.placed = placement;
    const { uploadedBytes, writes } = this.recordTexture.flush();
    context.stats.uploadedBytes += uploadedBytes;
    context.stats.bufferWrites += writes;
    this.isPlanned = canKeep;
  }

  /** Forgets the plan and frees every batch buffer. */
  clear(): void {
    for (const { items } of this.plan) {
      for (const item of items) if (item.kind === 'run') this.planner.release(item);
    }
    this.plan = [];
    this.batched = [];
    this.held = new Map();
    this.isBatchedBySlot = new Uint8Array(0);
    this.byEntry.clear();
    this.changed.clear();
    this.isPlanned = false;
  }

  /**
   * Draws an entry of this frame's plan, as often as it is asked (a layer's entries are drawn
   * once per tile); an entry not planned is left to the caller.
   *
   * @param context - The open render pass and the GPU instance buffer.
   * @param entry - The entry.
   * @param pipelines - The per-path pipelines (ordinary or retained-move).
   * @param placement - The retained move, if any.
   * @returns Whether the entry was planned and drawn.
   */
  draw(
    context: EntryDrawContext,
    entry: DrawListEntry,
    pipelines: PathPipelines,
    placement: MovePlacementBinding | undefined,
  ): boolean {
    const planned = this.byEntry.get(entry);
    if (!planned || !sameRanges(entry.ranges, planned.ranges)) return false;
    const { renderPass } = context;
    const batch = this.setup.pipelines;
    let single: PathLayerDraws | undefined;
    let draws = 0;
    for (const item of planned.items) {
      if (item.kind === 'layer') {
        single ??= new PathLayerDraws(
          renderPass,
          pipelines,
          context.instanceBuffer,
          placement?.indices,
        );
        single.drawLayer(item.layer, item.mesh, item.buffer, item.slot, item.isOpaque);
        continue;
      }
      draws += single?.draws ?? 0;
      single = undefined;
      renderPass.setPipeline(placement ? batch.moveStroke : batch.stroke);
      renderPass.setBindGroup(
        batch.bindGroupFor(this.recordTexture.texture, placement?.table.texture),
      );
      renderPass.setVertexBuffer(0, item.buffer);
      renderPass.draw(item.vertexCount, 1, 0, 0);
      draws += 1;
    }
    context.frame.stats.drawCalls += draws + (single?.draws ?? 0);
    return true;
  }

  /** Frees the batch buffers, the record texture and the pipelines. */
  destroy(): void {
    this.clear();
    this.recordTexture.destroy();
    this.setup.pipelines.destroy();
  }

  private replan(
    entries: readonly DrawListEntry[],
    context: FrameContext,
    held: HeldStrokes | undefined,
  ): void {
    const previous = new Map<number, BatchRun>();
    for (const { items } of this.plan) {
      for (const item of items) if (item.kind === 'run') previous.set(item.slots[0] ?? -1, item);
    }
    const batched: number[] = [];
    this.plan = entries.map((entry) => this.planner.plan(entry, previous, batched, context, held));
    for (const run of previous.values()) this.planner.release(run);
    const isBatchedBySlot = new Uint8Array(this.setup.instances.capacity);
    for (const slot of batched) isBatchedBySlot[slot] = 1;
    const nextHeld = new Map<ObjectId, { version: number; mesh: GpuPathMesh }>();
    for (const { resolved } of this.plan) {
      for (const { slot, id, version, mesh } of resolved) {
        if (isBatchedBySlot[slot] === 1) nextHeld.set(id, { version, mesh });
      }
    }
    this.held = nextHeld;
    this.isBatchedBySlot = isBatchedBySlot;
    this.batched = batched;
    this.live.plans += 1;
  }

  private sync(slots: readonly number[], indexData: Float32Array | undefined): void {
    this.recordTexture.sync(this.setup.instances, slots, (slot) => indexData?.[slot] ?? 0);
    this.live.syncedSlots += slots.length;
  }

  private indexEntries(entries: readonly DrawListEntry[]): void {
    this.byEntry.clear();
    entries.forEach((entry, index) => {
      const planned = this.plan[index];
      if (planned) this.byEntry.set(entry, planned);
    });
  }
}

/**
 * The batches of a drawer whose options ask for them.
 *
 * @param setup - The drawer's backend, pass name, records, camera and clip table.
 * @param options - The drawer's options.
 * @param options.isBatched - Whether it batches.
 * @param options.meshPageBytes - The mesh page size, which is also the largest batch buffer.
 * @param registry - Its slot owners.
 * @param meshes - The meshes its paths draw with this frame.
 * @returns The batches, or `undefined` when the drawer does not batch.
 */
export function createPathBatches(
  setup: ScenePassDrawerSetup,
  options: Pick<PathDrawerOptions, 'isBatched' | 'meshPageBytes'>,
  registry: PathRegistry,
  meshes: ReadonlyMap<ObjectId, GpuPathMesh>,
): PathBatches | undefined {
  if (options.isBatched !== true) return undefined;
  const { backend, passName, instances } = setup;
  return new PathBatches({
    backend,
    passName,
    instances,
    registry,
    meshes,
    pipelines: new PathBatchPipelines(
      backend,
      setup.cameraUniform.buffer,
      setup.clipTable,
      passName,
    ),
    maxBatchBytes: options.meshPageBytes ?? PATH_MESH_PAGE_BYTES,
  });
}
