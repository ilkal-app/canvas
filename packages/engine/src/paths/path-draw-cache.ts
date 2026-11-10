import type { ObjectId } from '@canvas/schema';

import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type { InstanceLayout } from '../scene/instance-layout.js';
import type { InstanceRange } from '../scene/scene-culler.js';
import type { EntryDrawContext } from '../scene/scene-pass-drawer.js';

import type { GpuPathMesh } from './gpu-path-mesh.js';
import { PathLayerDraws } from './path-layer-draws.js';
import type { PathLayer } from './path-layers.js';
import type { PathPipelines } from './path-pipelines.js';
import type { PathRegistry } from './path-registry.js';

/** Layer colour alpha follows placement and RGB in each instance record. */
const ALPHA_FLOAT = 7;

/**
 * Whether a path layer may take the opaque route: straight into colour without the
 * stencil, where overlapping triangles (a stroke's joins) would blend twice if it were
 * translucent. Only a layer whose colour is opaque and that no opacity fades, its own or an
 * ancestor's, may.
 *
 * @param alpha - The layer colour's alpha.
 * @param multiplier - The record's layer opacity (1 minus its transparency).
 * @returns Whether the layer draws opaque.
 */
export function isOpaquePathLayer(alpha: number, multiplier: number): boolean {
  return alpha === 1 && multiplier === 1;
}

interface ResolvedLayer {
  readonly layer: PathLayer;
  readonly mesh: GpuPathMesh;
  readonly buffer: GpuBuffer;
  readonly slot: number;
  readonly isOpaque: boolean;
}

interface EntrySnapshot {
  readonly ranges: readonly InstanceRange[];
  layers: readonly ResolvedLayer[] | undefined;
}

/** Resolution work and bounded retained history for one path drawer. */
export interface PathDrawCacheCounts {
  /** Slot-owner resolutions since construction, including uncached frames. */
  readonly resolvedSlots: number;
  /** Frame-mesh lookups after finding a slot owner. */
  readonly meshReads: number;
  /** Instance alpha reads after finding a drawable mesh. */
  readonly alphaReads: number;
  /** Previously resolved layers replayed through the original draw encoder. */
  readonly replayedLayers: number;
  /** Entries retained from at most one frame. */
  readonly retainedEntries: number;
  /** Resolved layers retained from at most one frame. */
  readonly retainedLayers: number;
}

/** Reuses settled layer resolution without changing any backend command or entry boundary. */
export class PathDrawCache {
  private entries: EntrySnapshot[] | undefined;
  private nextEntry = 0;
  private isEnabled = false;
  private buffer: GpuBuffer | undefined;
  private layout: InstanceLayout | undefined;
  private epoch = 0;
  private resolvedSlots = 0;
  private meshReads = 0;
  private alphaReads = 0;
  private replayedLayers = 0;

  /**
   * Creates one bounded cache for a drawer's live records and prepared meshes.
   *
   * @param passName - The path pass.
   * @param instances - Its current CPU records.
   * @param registry - Slot owners, invalidated with document changes.
   * @param meshes - The current prepared meshes, invalidated on landing or dropping.
   */
  constructor(
    private readonly passName: string,
    private readonly instances: InstanceBuffer,
    private readonly registry: PathRegistry,
    private readonly meshes: ReadonlyMap<ObjectId, GpuPathMesh>,
  ) {}

  /**
   * Epoch used to reject an invalidation after a preparation reuse decision.
   *
   * @returns The current invalidation generation.
   */
  get generation(): number {
    return this.epoch;
  }

  /**
   * Resolution counters and retained history, without exposing layer references.
   *
   * @returns A copied diagnostic snapshot.
   */
  get counts(): PathDrawCacheCounts {
    return {
      resolvedSlots: this.resolvedSlots,
      meshReads: this.meshReads,
      alphaReads: this.alphaReads,
      replayedLayers: this.replayedLayers,
      retainedEntries: this.entries?.length ?? 0,
      retainedLayers:
        this.entries?.reduce((sum, entry) => sum + (entry.layers?.length ?? 0), 0) ?? 0,
    };
  }

  /** Drops all retained buffers and disables caching until the next proven preparation. */
  invalidate(): void {
    this.epoch += 1;
    this.entries = undefined;
    this.buffer = undefined;
    this.layout = undefined;
    this.isEnabled = false;
  }

  /**
   * Starts a frame only after mesh scheduling, timeout handling and eviction have run.
   *
   * @param drawList - Current full draw order; only this pass's exact entries are retained.
   * @param reuseGeneration - Epoch captured before preparation reused its prior work; absent
   * for a newly prepared frame, which must discard all prior resolved layers.
   * @param canStore - Whether preparation settled without pending or stand-in work.
   */
  beginFrame(
    drawList: readonly DrawListEntry[],
    reuseGeneration: number | undefined,
    canStore: boolean,
  ): void {
    const entries = drawList.filter((entry) => entry.passName === this.passName);
    const isStale = reuseGeneration !== undefined && reuseGeneration !== this.epoch;
    const canKeep =
      reuseGeneration !== undefined &&
      !isStale &&
      this.nextEntry === this.entries?.length &&
      entries.length === this.entries.length &&
      entries.every((entry, index) => sameRanges(entry.ranges, this.entries?.[index]?.ranges));
    if (!canStore || isStale) this.invalidate();
    else if (!canKeep) {
      this.invalidate();
      this.entries = entries.map((entry) => ({
        ranges: entry.ranges.map((range) => ({ ...range })),
        layers: undefined,
      }));
    }
    this.isEnabled = canStore && !isStale;
    this.nextEntry = 0;
  }

  /**
   * Draws a single entry, preserving its original pipeline and stencil sequence.
   *
   * @param context - The live render pass and current GPU instance buffer.
   * @param entry - The exact current entry.
   * @param pipelines - The drawer's current ordinary or retained-placement pipelines.
   * @param indices - Optional per-record placement indices for a retained move.
   */
  draw(
    context: EntryDrawContext,
    entry: DrawListEntry,
    pipelines: PathPipelines,
    indices?: GpuBuffer,
  ): void {
    const draws = new PathLayerDraws(
      context.renderPass,
      pipelines,
      context.instanceBuffer,
      indices,
    );
    const index = this.nextEntry++;
    const snapshot = this.entries?.[index];
    if (
      this.isEnabled &&
      (!sameRanges(entry.ranges, snapshot?.ranges) ||
        (this.buffer !== undefined && this.buffer !== context.instanceBuffer) ||
        (this.layout !== undefined && this.layout !== this.instances.layout))
    )
      this.invalidate();
    if (this.isEnabled && snapshot?.layers) {
      for (const layer of snapshot.layers) {
        draws.drawLayer(layer.layer, layer.mesh, layer.buffer, layer.slot, layer.isOpaque);
        this.replayedLayers += 1;
      }
    } else {
      const retained = this.isEnabled ? ([] as ResolvedLayer[]) : undefined;
      this.resolve(entry, draws, retained);
      if (retained && snapshot) {
        snapshot.layers = retained;
        this.buffer = context.instanceBuffer;
        this.layout = this.instances.layout;
      }
    }
    context.frame.stats.drawCalls += draws.draws;
  }

  private resolve(
    entry: DrawListEntry,
    draws: PathLayerDraws,
    retained: ResolvedLayer[] | undefined,
  ): void {
    const { data, layout } = this.instances;
    for (const { start, count } of entry.ranges) {
      for (let slot = start; slot < start + count; slot += 1) {
        this.resolvedSlots += 1;
        const owner = this.registry.ownerOf(slot);
        const mesh = owner && this.meshes.get(owner.path.id);
        if (owner) this.meshReads += 1;
        if (!owner || !mesh?.buffer) continue;
        this.alphaReads += 1;
        const record = slot * layout.floatsPerRecord;
        const { opacityFloat } = layout;
        const transparency = opacityFloat === undefined ? 0 : (data[record + opacityFloat] ?? 0);
        const isOpaque = isOpaquePathLayer(data[record + ALPHA_FLOAT] ?? 0, 1 - transparency);
        draws.drawLayer(owner.layer, mesh, mesh.buffer, slot, isOpaque);
        retained?.push({ layer: owner.layer, mesh, buffer: mesh.buffer, slot, isOpaque });
      }
    }
  }
}

/**
 * Whether two entries' ranges are the same.
 *
 * @param a - One entry's ranges.
 * @param b - The other's, if any.
 * @returns Whether they match range for range.
 */
export function sameRanges(
  a: readonly InstanceRange[],
  b: readonly InstanceRange[] | undefined,
): boolean {
  return (
    a.length === b?.length &&
    a.every((range, index) => range.start === b[index]?.start && range.count === b[index].count)
  );
}
