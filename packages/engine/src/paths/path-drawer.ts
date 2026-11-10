import type { ObjectId } from '@canvas/schema';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { MovePlacementBinding } from '../gpu/move-placement.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type {
  DrawerMemory,
  EntryDrawContext,
  ScenePassDrawer,
  ScenePassDrawerSetup,
} from '../scene/scene-pass-drawer.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { BoundsVisibilityWitness } from '../spatial/bounds-visibility-witness.js';
import { intersectsBounds } from '../spatial/bounds.js';

import { CHORD_BUCKET, chordMeshRequestOf } from './chord-mesh.js';
import { pickFlattenBucket } from './flatten-bucket.js';
import { uploadPathMesh, type GpuPathMesh } from './gpu-path-mesh.js';
import { isLiveStroke, isMeshedInline, LIVE_STROKE_SEGMENTS_PER_FRAME } from './inline-mesh.js';
import { MeshBuilds } from './mesh-builds.js';
import { MeshCache } from './mesh-cache.js';
import type { MeshJobResponse } from './mesh-job-payload.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';
import { meshSegmentsOf } from './mesh-segments.js';
import { createPathBatches, type PathBatchCounts, type PathBatches } from './path-batches.js';
import { observePathCandidate, type PathCandidates } from './path-candidate-visibility.js';
import { PathDrawCache } from './path-draw-cache.js';
import type { PathDrawerOptions } from './path-drawer-options.js';
import { installPathDrawerStages } from './path-drawer-stages.js';
import { PathFrameCounts } from './path-frame-report.js';
import { PATH_MESH_PAGE_BYTES, PathMeshArena } from './path-mesh-arena.js';
import { PathMoveState } from './path-move-state.js';
import { createPathPipelines, destroyPathPipelines, type PathPipelines } from './path-pipelines.js';
import { PathPreparationCache } from './path-preparation-cache.js';
import { registerPathPreview } from './path-preview-readiness.js';
import type { PathRecordTexture } from './path-record-texture.js';
import { PathRegistry, type TrackedPath } from './path-registry.js';

export type { PathDrawerOptions } from './path-drawer-options.js';

export { PREPARE_PATH_MESHES_STAGE } from './path-drawer-options.js';

/** Builds bounded path meshes before drawing ordered stencil fills and strokes. */
export class PathDrawer implements ScenePassDrawer {
  private readonly backend: GpuBackend;
  private readonly passName: string;
  /** The shared vertex buffers the meshes are in. */
  private readonly arena: PathMeshArena;
  private readonly instances: InstanceBuffer;
  private readonly options: PathDrawerOptions;
  private readonly pipelines: PathPipelines;
  private readonly move: PathMoveState;
  private readonly cache: MeshCache<GpuPathMesh>;
  private readonly registry: PathRegistry;
  /** The mesh each path draws with this frame. */
  private readonly frameMeshes = new Map<ObjectId, GpuPathMesh>();
  /** Builds in flight, timed out and failed. */
  private readonly builds: MeshBuilds;
  private readonly counts = new PathFrameCounts();
  private readonly preparation: PathPreparationCache;
  private readonly drawCache: PathDrawCache;
  /** Batched opaque strokes, when the options ask for them. */
  private readonly batches: PathBatches | undefined;
  /** The batched strokes' path records, when the pass batches. */
  readonly recordTexture: PathRecordTexture | undefined;
  private visibility = new BoundsVisibilityWitness();
  private readonly candidates: PathCandidates = new Map();
  private bucket: number | undefined;
  private isBehind = false;
  private hasExactFrame = false;
  private isDestroyed = false;
  /** The cache's regenerations already added to a frame's statistics. */
  private reportedRegenerations = 0;

  /**
   * Creates the drawer's pipelines and its empty cache.
   *
   * @param setup - The renderer's backend, instance buffer and camera uniform for the pass.
   * @param pass - The path pass, for its shader and record layout.
   * @param options - How meshes are built and kept.
   */
  constructor(setup: ScenePassDrawerSetup, pass: ScenePass, options: PathDrawerOptions) {
    this.move = new PathMoveState(setup, pass);
    this.backend = setup.backend;
    this.passName = setup.passName;
    this.preparation = new PathPreparationCache(setup.passName);
    this.arena = new PathMeshArena(
      setup.backend,
      `${setup.passName} mesh`,
      options.meshPageBytes ?? PATH_MESH_PAGE_BYTES,
    );
    this.instances = setup.instances;
    this.options = options;
    this.pipelines = createPathPipelines(
      setup.backend,
      pass.pipelineSpec,
      pass.layout,
      setup.cameraUniform.buffer,
      setup.clipTable,
      setup.passName,
      undefined,
      pass,
    );
    this.cache = new MeshCache<GpuPathMesh>({
      byteBudget: options.meshByteBudget,
      onDrop: (mesh) => {
        this.invalidatePreparation();
        if (mesh.placement) this.arena.release(mesh.placement);
      },
    });
    this.registry = new PathRegistry(
      setup.passName,
      (id) => {
        this.cache.deleteObject(id);
        this.builds.forget(id);
      },
      options.layersOf,
    );
    this.drawCache = new PathDrawCache(
      this.passName,
      this.instances,
      this.registry,
      this.frameMeshes,
    );
    this.batches = createPathBatches(setup, options, this.registry, this.frameMeshes);
    this.recordTexture = this.batches?.recordTexture;
    this.builds = new MeshBuilds({
      builder: options.meshBuilder,
      onLanded: (response) => {
        this.land(response);
      },
      onFault: (error) => options.onFault?.(error),
      ...(options.buildTimeoutFrames === undefined
        ? {}
        : { timeoutFrames: options.buildTimeoutFrames }),
    });
    const isReady = () => !this.isDestroyed && this.hasExactFrame && !this.hasPendingWork();
    registerPathPreview(pass, this.instances, options.meshBuilder, isReady);
  }

  /**
   * Wraps `collectChanges` to track paths, and inserts the mesh stage before `draw`.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    installPathDrawerStages(frame, {
      passName: this.passName,
      hasDirtyRecords: () => this.instances.dirtyRanges.length > 0,
      noteChanges: () => this.batches?.noteChangedSlots(this.instances.changedSlots),
      invalidate: () => {
        this.invalidatePreparation();
      },
      observe: (changes, context) => {
        this.registry.observe(changes, context.scene);
      },
      prepare: (context) => {
        this.prepareFrame(context);
      },
    });
  }

  /**
   * Selects the session's absolute placements before mesh culling and drawing.
   *
   * @param placement - Borrowed table and indices; undefined restores ordinary records.
   */
  setMovePlacement(placement: MovePlacementBinding | undefined): void {
    if (placement === this.move.placement) return;
    this.move.set(placement);
    this.invalidatePreparation();
  }

  /**
   * Draws an entry's records in order: each record is one layer of one path.
   *
   * @param context - The frame, the open render pass and the GPU instance buffer.
   * @param entry - The entry.
   */
  drawEntry(context: EntryDrawContext, entry: DrawListEntry): void {
    if (this.instances.dirtyRanges.length > 0) this.invalidatePreparation();
    const { placement, pipelines = this.pipelines } = this.move;
    if (this.batches?.draw(context, entry, pipelines, placement)) return;
    this.drawCache.draw(context, entry, pipelines, placement?.indices);
  }

  /**
   * The batched strokes' plans built and slots synced so far, for tests and diagnostics.
   *
   * @returns A copy, or `undefined` when the pass does not batch.
   */
  get batchCounts(): PathBatchCounts | undefined {
    return this.batches?.counts;
  }

  /**
   * Whether meshes are being built, or visible paths still wait for theirs.
   *
   * @returns True while a later frame would draw something new.
   */
  hasPendingWork(): boolean {
    return this.builds.size > 0 || this.isBehind;
  }

  /**
   * The GPU bytes of the shared mesh pages (free room included) and the batches.
   *
   * @returns The category (`meshes`) and bytes.
   */
  memory(): DrawerMemory {
    return { category: 'meshes', bytes: this.arena.byteLength + (this.batches?.byteLength ?? 0) };
  }

  /** Frees every mesh buffer and the pipelines; builds still in flight are dropped on arrival. */
  destroy(): void {
    this.isDestroyed = true;
    this.invalidatePreparation();
    this.builds.stop();
    this.cache.clear();
    this.arena.destroy();
    this.frameMeshes.clear();
    this.candidates.clear();
    destroyPathPipelines(this.pipelines);
    this.batches?.destroy();
    this.move.destroy();
  }

  private invalidatePreparation(): void {
    this.preparation.invalidate();
    this.drawCache.invalidate();
  }

  private prepareFrame(context: FrameContext): void {
    // An idle pass (no gradient path on the board) draws nothing, exactly.
    const { instances, frameMeshes, cache } = this;
    if (instances.liveCount + frameMeshes.size + cache.byteLength === 0 && !this.hasPendingWork()) {
      this.batches?.clear();
      this.hasExactFrame = true;
      return;
    }
    const { camera, drawList, viewport } = context;
    if (this.move.takeChange()) this.invalidatePreparation();
    this.bucket = pickFlattenBucket(camera.zoom * camera.dpr, this.bucket);
    if (this.instances.dirtyRanges.length > 0) this.invalidatePreparation();
    const drawGeneration = this.drawCache.generation;
    const canReuse = !this.hasPendingWork() && this.preparation.reuse(context, this.bucket);
    const canReuseCandidates =
      !canReuse && !this.hasPendingWork() && this.preparation.reuseCandidates(context, this.bucket);
    // A timeout/failure fallback may land an offscreen mesh in beginFrame. Its cache pin
    // lasts only this frame; prepare once more before retaining an unchanged active epoch.
    const hasPendingBuilds = this.builds.size > 0;
    this.cache.beginFrame(context.timeMs, canReuse || canReuseCandidates);
    this.builds.beginFrame();
    if (!canReuse && !canReuseCandidates) {
      this.candidates.clear();
      this.invalidatePreparation();
      this.frameMeshes.clear();
      this.visibility = new BoundsVisibilityWitness();
    }
    this.isBehind = false;
    this.hasExactFrame = true;
    const { counts } = this;
    counts.reset();
    if (canReuseCandidates) this.prepareViewport(context, counts, this.bucket);
    for (const { passName, ranges } of canReuse || canReuseCandidates ? [] : drawList) {
      if (passName !== this.passName) continue;
      for (const { start, count } of ranges) {
        for (let slot = start; slot < start + count; slot += 1) {
          const path = this.registry.ownerOf(slot)?.path;
          if (!path || this.frameMeshes.has(path.id)) continue;
          const { instances: records, move, candidates, visibility } = this;
          if (
            !observePathCandidate(path, viewport, records, move.placement, candidates, visibility)
          )
            continue;
          const mesh = this.meshFor(path, this.bucket, context, counts);
          if (mesh) this.frameMeshes.set(path.id, mesh);
        }
      }
    }
    this.cache.trim();
    let canStoreDraws =
      (canReuse || canReuseCandidates) && drawGeneration === this.drawCache.generation;
    if (
      !canReuse &&
      !canReuseCandidates &&
      !hasPendingBuilds &&
      !this.hasPendingWork() &&
      counts.standIns === 0
    ) {
      this.preparation.remember(context, this.bucket, this.visibility);
      canStoreDraws = true;
    }
    if (canReuseCandidates && !this.hasPendingWork() && counts.standIns === 0) {
      this.visibility = new BoundsVisibilityWitness();
      for (const { bounds } of this.candidates.values()) this.visibility.observe(viewport, bounds);
      this.preparation.remember(context, this.bucket, this.visibility);
      canStoreDraws = true;
    }
    this.drawCache.beginFrame(
      drawList,
      canReuse || canReuseCandidates ? drawGeneration : undefined,
      canStoreDraws,
    );
    this.batches?.prepare(context, this.move.placement, canStoreDraws);
    const regenerated = this.cache.regenerations;
    context.stats.meshRegenerations += regenerated - this.reportedRegenerations;
    this.reportedRegenerations = regenerated;
    const { onFrame } = this.options;
    if (onFrame)
      onFrame(counts.report(this.bucket, this.frameMeshes.size, this.cache, this.builds.size));
  }

  private prepareViewport(context: FrameContext, counts: PathFrameCounts, bucket: number): void {
    for (const { path, bounds } of this.candidates.values()) {
      const isVisible = intersectsBounds(context.viewport, bounds);
      if (isVisible === this.frameMeshes.has(path.id)) continue;
      this.drawCache.invalidate();
      if (!isVisible) {
        this.frameMeshes.delete(path.id);
        this.cache.unpin(path.id);
        continue;
      }
      const mesh = this.meshFor(path, bucket, context, counts);
      if (mesh) this.frameMeshes.set(path.id, mesh);
    }
  }

  /**
   * The mesh a path draws this frame: its bucket's (chords' under 6 device px), built in budget
   * (a live stroke first, `isLiveStroke`; inline `isMeshedInline`), else the nearest stand-in.
   *
   * @param path - The path.
   * @param frameBucket - The frame's zoom bucket.
   * @param context - The frame, whose stats count inline uploads.
   * @param counts - The frame's counters.
   * @returns The mesh, or `undefined` when the path has none yet.
   */
  private meshFor(
    path: TrackedPath,
    frameBucket: number,
    context: FrameContext,
    counts: PathFrameCounts,
  ): GpuPathMesh | undefined {
    const isChord = context.scene.levelOfDetail.formOf(this.passName, path.id) === 'chord';
    const bucket = isChord ? CHORD_BUCKET : frameBucket;
    const exact = this.cache.get(path.id, path.version, bucket);
    if (exact) return exact;
    const request =
      bucket === CHORD_BUCKET
        ? chordMeshRequestOf(path.object, path.version, path.localBounds)
        : meshJobRequestOf(path.object, path.version, bucket);
    if (this.builds.canRequest(request)) {
      const segments = meshSegmentsOf(path.object);
      const isOlder = this.cache.hasOlderVersion(path.id, path.version);
      const isRoom = counts.prioritySegments + segments <= LIVE_STROKE_SEGMENTS_PER_FRAME;
      const isPriority = isRoom && isLiveStroke(path.object, segments);
      const sent = counts.segmentsSent;
      if (!isPriority && sent > 0 && sent + segments > this.options.maxMeshSegmentsPerFrame) {
        this.isBehind = true;
      } else {
        if (isPriority) counts.prioritySegments += segments;
        else counts.segmentsSent += segments;
        const isInline =
          isPriority || isMeshedInline(path.object.type, isOlder, segments, counts.segmentsInline);
        if (isInline && !isPriority) counts.segmentsInline += segments;
        const built = isInline ? runMeshJob(request) : this.builds.request(request);
        if (built) {
          const mesh = this.land(built);
          context.stats.bufferWrites += mesh?.buffer ? 1 : 0;
          context.stats.uploadedBytes += mesh?.byteLength ?? 0;
          counts.meshesBuilt += 1;
          if (mesh === undefined) this.hasExactFrame = false;
          return mesh;
        }
      }
    }
    this.hasExactFrame = false;
    const standIn = this.cache.nearest(path.id, bucket);
    if (standIn) counts.standIns += 1;
    return standIn;
  }

  /**
   * Uploads a built mesh and caches it, unless its path is no longer drawn.
   *
   * @param response - The built mesh.
   * @returns The mesh on the GPU, or `undefined` when its path is gone.
   */
  private land(response: MeshJobResponse): GpuPathMesh | undefined {
    if (!this.registry.get(response.objectId as ObjectId)) return undefined;
    this.invalidatePreparation();
    const mesh = uploadPathMesh(this.arena, response, this.batches !== undefined);
    this.cache.set(response.objectId, response.version, response.bucket, mesh);
    return mesh;
  }
}
