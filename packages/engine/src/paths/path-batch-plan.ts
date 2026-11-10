// The plan of the batched opaque path strokes: each of the pass's draw-list entries as
// runs of consecutive opaque strokes, each one batch buffer of (x, y, record slot) vertices, and
// the layers between them drawn on their own. A plan depends only on which path and layer own
// the entry's slots, the meshes they draw and their opacity class, so `isPlanCurrent` can keep it
// across frames where paths only move or recolour (path-batches.ts re-syncs their texels).
import type { ObjectId } from '@canvas/schema';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type { InstanceRange } from '../scene/scene-culler.js';

import type { GpuPathMesh } from './gpu-path-mesh.js';
import { PATH_BATCH_VERTEX_FLOATS } from './path-batch-pipelines.js';
import { isOpaquePathLayer, sameRanges } from './path-draw-cache.js';
import type { PathLayer } from './path-layers.js';
import type { PathRecordOwner, PathRegistry } from './path-registry.js';

/** Layer colour alpha follows placement and RGB in each instance record. */
const ALPHA_FLOAT = 7;

/** A run of opaque strokes in one batch buffer: one draw. */
export interface BatchRun {
  readonly kind: 'run';
  readonly buffer: GpuBuffer;
  readonly vertexCount: number;
  /** The run's record slots and meshes, in paint order: what its buffer holds. */
  readonly slots: readonly number[];
  readonly meshes: readonly GpuPathMesh[];
}

/** A layer drawn on its own, through the per-path sequence. */
export interface SingleLayer {
  readonly kind: 'layer';
  readonly layer: PathLayer;
  readonly mesh: GpuPathMesh;
  readonly buffer: GpuBuffer;
  readonly slot: number;
  readonly isOpaque: boolean;
}

/** One step of a planned entry. */
export type PlanItem = BatchRun | SingleLayer;

/** A drawable slot as the plan saw it: what must still hold for the plan to be kept. */
interface ResolvedSlot {
  readonly slot: number;
  readonly id: ObjectId;
  readonly version: number;
  readonly layer: PathLayer;
  readonly mesh: GpuPathMesh;
  readonly isOpaque: boolean;
}

/** An entry's plan. */
export interface PlannedEntry {
  readonly ranges: readonly InstanceRange[];
  readonly items: readonly PlanItem[];
  /** Every drawable slot of the entry in order, batched or not. */
  readonly resolved: readonly ResolvedSlot[];
}

/** What a plan is made from. */
export interface PlanSources {
  /** The backend that creates and writes the batch buffers. */
  readonly backend: GpuBackend;
  /** The path pass. */
  readonly passName: string;
  /** The pass's CPU records. */
  readonly instances: InstanceBuffer;
  /** Slot owners. */
  readonly registry: PathRegistry;
  /** The meshes the paths draw with this frame. */
  readonly meshes: ReadonlyMap<ObjectId, GpuPathMesh>;
  /**
   * The largest batch buffer, bytes: a longer run is split, and a stroke larger than this draws
   * on its own.
   */
  readonly maxBatchBytes: number;
}

/**
 * The batched strokes of the current plan, by path: during a retained move one that leaves the
 * viewport (the drawer's exact test drops its frame mesh) keeps its batch while its version holds,
 * since its moved bounds would otherwise change the plan every frame of the move; the
 * GPU clips its triangles.
 */
export type HeldStrokes = ReadonlyMap<
  ObjectId,
  { readonly version: number; readonly mesh: GpuPathMesh }
>;

/** A run being gathered: its slots and meshes, and its vertex count so far. */
interface OpenRun {
  slots: number[];
  meshes: GpuPathMesh[];
  vertexCount: number;
}

/**
 * Whether a slot's record draws opaque now (its layer colour's alpha and its layer opacity).
 *
 * @param instances - The pass's records.
 * @param slot - The slot.
 * @returns Whether it is opaque.
 */
function isOpaqueAt(instances: InstanceBuffer, slot: number): boolean {
  const { data, layout } = instances;
  const record = slot * layout.floatsPerRecord;
  const { opacityFloat } = layout;
  const transparency = opacityFloat === undefined ? 0 : (data[record + opacityFloat] ?? 0);
  return isOpaquePathLayer(data[record + ALPHA_FLOAT] ?? 0, 1 - transparency);
}

/**
 * The mesh a slot draws with: its path's frame mesh, else, during a retained move, the held mesh
 * of an opaque batched stroke whose path is unchanged.
 *
 * @param sources - The records and meshes.
 * @param owner - The slot's owner.
 * @param slot - The slot.
 * @param held - The plan's held strokes during a retained move; undefined otherwise.
 * @returns The mesh, or `undefined` when the slot draws nothing this frame.
 */
function meshAt(
  sources: PlanSources,
  owner: PathRecordOwner,
  slot: number,
  held: HeldStrokes | undefined,
): GpuPathMesh | undefined {
  const mesh = sources.meshes.get(owner.path.id);
  if (mesh?.buffer) return mesh;
  const kept = held?.get(owner.path.id);
  if (owner.layer !== 'stroke' || kept?.version !== owner.path.version) return undefined;
  // Only as a batched stroke: its mesh's own buffer may have gone with the cache.
  return isOpaqueAt(sources.instances, slot) ? kept.mesh : undefined;
}

/**
 * Whether a kept plan still is the plan the entry would get now: the same ranges, and every
 * slot in them owned by the same path and layer, drawing the same mesh, in the same opacity class
 * (and no slot drawable that was not). Allocates nothing.
 *
 * @param sources - The records, slot owners and meshes.
 * @param planned - The kept plan of the entry.
 * @param entry - The entry this frame.
 * @param held - The plan's held strokes during a retained move; undefined otherwise.
 * @returns Whether the plan holds.
 */
export function isPlanCurrent(
  sources: PlanSources,
  planned: PlannedEntry | undefined,
  entry: DrawListEntry,
  held?: HeldStrokes,
): boolean {
  if (!planned || !sameRanges(entry.ranges, planned.ranges)) return false;
  const { registry, instances } = sources;
  const { resolved } = planned;
  let at = 0;
  for (const { start, count } of entry.ranges) {
    for (let slot = start; slot < start + count; slot += 1) {
      const owner = registry.ownerOf(slot);
      const mesh = owner && meshAt(sources, owner, slot, held);
      if (!owner || !mesh?.buffer) continue;
      const seen = resolved[at];
      if (
        seen?.slot !== slot ||
        seen.id !== owner.path.id ||
        seen.version !== owner.path.version ||
        seen.layer !== owner.layer ||
        seen.mesh !== mesh ||
        seen.isOpaque !== isOpaqueAt(instances, slot)
      ) {
        return false;
      }
      at += 1;
    }
  }
  return at === resolved.length;
}

/** Builds plans and owns their batch buffers. */
export class BatchPlanner {
  private bytes = 0;

  /**
   * Creates an empty planner.
   *
   * @param sources - The backend, records, slot owners, meshes and batch cap.
   */
  constructor(private readonly sources: PlanSources) {}

  /**
   * The batch buffers' bytes.
   *
   * @returns The bytes.
   */
  get byteLength(): number {
    return this.bytes;
  }

  /**
   * Plans an entry. A run whose slots and meshes are those of a previous run keeps its buffer.
   *
   * @param entry - The entry.
   * @param previous - The previous plan's runs not yet reused, by first slot; reused ones are
   *   taken out.
   * @param batched - Receives the slots of the batched strokes.
   * @param context - The frame, whose stats count the uploads.
   * @param held - The previous plan's held strokes during a retained move; undefined otherwise.
   * @returns The plan.
   */
  plan(
    entry: DrawListEntry,
    previous: Map<number, BatchRun>,
    batched: number[],
    context: FrameContext,
    held?: HeldStrokes,
  ): PlannedEntry {
    const { instances, registry, maxBatchBytes } = this.sources;
    const items: PlanItem[] = [];
    const resolved: ResolvedSlot[] = [];
    let open: OpenRun | undefined;
    const close = (): void => {
      if (open) items.push(this.runOf(open, previous, context));
      open = undefined;
    };
    for (const { start, count } of entry.ranges) {
      for (let slot = start; slot < start + count; slot += 1) {
        const owner = registry.ownerOf(slot);
        const mesh = owner && meshAt(this.sources, owner, slot, held);
        if (!owner || !mesh?.buffer) continue;
        const isOpaque = isOpaqueAt(instances, slot);
        const { layer, path } = owner;
        resolved.push({ slot, id: path.id, version: path.version, layer, mesh, isOpaque });
        const { strokeVertices } = mesh;
        const vertexCount = (strokeVertices?.length ?? 0) / 2;
        // A stroke larger than a batch draws on its own, as every stroke did before.
        const isBatchable = vertexCount * PATH_BATCH_VERTEX_FLOATS * 4 <= maxBatchBytes;
        if (layer === 'stroke' && isOpaque && strokeVertices && isBatchable) {
          const bytes = (open?.vertexCount ?? 0) + vertexCount;
          if (open && bytes * PATH_BATCH_VERTEX_FLOATS * 4 > maxBatchBytes) close();
          open ??= { slots: [], meshes: [], vertexCount: 0 };
          open.slots.push(slot);
          open.meshes.push(mesh);
          open.vertexCount += vertexCount;
          batched.push(slot);
          continue;
        }
        close();
        items.push({ kind: 'layer', layer, mesh, buffer: mesh.buffer, slot, isOpaque });
      }
    }
    close();
    return { ranges: entry.ranges.map((range) => ({ ...range })), items, resolved };
  }

  /**
   * Frees a run's buffer.
   *
   * @param run - The run.
   */
  release(run: BatchRun): void {
    run.buffer.destroy();
    this.bytes -= run.vertexCount * PATH_BATCH_VERTEX_FLOATS * 4;
  }

  /**
   * The batch of a gathered run: the previous plan's when its slots and meshes are the same, else
   * a new buffer of the run's vertices.
   *
   * @param open - The run.
   * @param previous - The previous plan's runs not yet reused, by first slot.
   * @param context - The frame, whose stats count the upload.
   * @returns The batch.
   */
  private runOf(open: OpenRun, previous: Map<number, BatchRun>, context: FrameContext): BatchRun {
    const first = open.slots[0] ?? -1;
    const kept = previous.get(first);
    if (
      kept?.slots.length === open.slots.length &&
      kept.slots.every((slot, index) => slot === open.slots[index]) &&
      kept.meshes.every((mesh, index) => mesh === open.meshes[index])
    ) {
      previous.delete(first);
      return kept;
    }
    const data = new Float32Array(open.vertexCount * PATH_BATCH_VERTEX_FLOATS);
    let at = 0;
    open.meshes.forEach((mesh, index) => {
      const vertices = mesh.strokeVertices ?? new Float32Array(0);
      const slot = open.slots[index] ?? 0;
      for (let vertex = 0; vertex < vertices.length; vertex += 2) {
        data[at] = vertices[vertex] ?? 0;
        data[at + 1] = vertices[vertex + 1] ?? 0;
        data[at + 2] = slot;
        at += PATH_BATCH_VERTEX_FLOATS;
      }
    });
    const { backend, passName } = this.sources;
    const buffer = backend.createBuffer({
      usage: 'vertex',
      byteLength: Math.max(4, data.byteLength),
      label: `${passName} stroke batch`,
    });
    backend.writeBuffer(buffer, 0, data);
    context.stats.bufferWrites += 1;
    context.stats.uploadedBytes += data.byteLength;
    this.bytes += data.byteLength;
    const { slots, meshes, vertexCount } = open;
    return { kind: 'run', buffer, vertexCount, slots, meshes };
  }
}
