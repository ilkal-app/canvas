import type { AssetId, ObjectId } from '@canvas/schema';

import { isSameScale } from '../camera/camera-scale.js';
import { isSameCamera, type Camera } from '../camera/camera.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { SceneObject } from '../scene/scene-pass.js';
import type { DecodedLevel } from '../workers/job-kinds.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { ImageBinding } from './image-binding.js';
import { CandidateFinder } from './image-candidates.js';
import { ImageDrawTally } from './image-draw-tally.js';
import { ImageIndex } from './image-index.js';
import { assetOfKey, type AssetView, type ObjectPlan } from './image-needs.js';
import { ImagePlanner } from './image-planner.js';
import { imagePreviewOf, registerImagePreview } from './image-preview-registry.js';
import { ImagePreviewTracker } from './image-preview-tracker.js';
import type { LevelSource } from './level-loader.js';
import { requestLevelLoads } from './level-requests.js';
import type { ResidencyImage } from './residency-image.js';
import type {
  ImageFrameInput,
  ImageFrameResult,
  TextureManagerOptions,
  TextureManagerStats,
} from './texture-manager-options.js';
import { createTextureManagerParts, type TextureManagerParts } from './texture-manager-parts.js';
import { VisiblePendingReport } from './visible-pending-report.js';

/** Of the `textures` budget, the share chosen levels may plan for; atlas pages use the rest. */
const LEVEL_PLAN_SHARE = 0.8;

/**
 * The client texture manager: for every visible image it picks a level
 * from the on-screen size × DPR with hysteresis, keeps the smallest level of every visible
 * image resident (so an image is never blank), prefetches along the pan, loads through the pool
 * by priority, uploads under the `textures` budget with larger-first LRU eviction, packs small
 * levels and tiles into atlases, shows only the visible tiles of large images, and starts over at
 * the smallest levels after a device loss. The image pass feeds it (`track`, `forget`) and draws
 * its bindings; `update` runs once per frame before the upload stage. A still frame plans
 * nothing, and camera movement within unchanged level bands with no event plans nothing either (no image changes
 * level, so camera-only frames stay cheap). On the thread that renders.
 */
export class TextureManager {
  /** Counters since creation. */
  readonly stats: TextureManagerStats = {
    uploads: 0,
    evictions: 0,
    blankImageFrames: 0,
    allocationFailures: 0,
    decoderMissingFailures: 0,
  };
  private readonly index = new ImageIndex();
  private readonly parts: TextureManagerParts;
  private readonly catalogue: AssetCatalogue;
  private readonly stopListening: () => void;
  private readonly objectsByAsset = new Map<AssetId, Set<ObjectId>>();
  private readonly planner = new ImagePlanner();
  /** Plans what the images want, without side effects, while the text atlas borrows. */
  private readonly demandProbe = new ImagePlanner();
  private readonly candidates = new CandidateFinder();
  private readonly dirtyAssets = new Set<AssetId>();
  private readonly tally = new ImageDrawTally();
  private readonly pending = new VisiblePendingReport();
  private isStale = true;
  /** Whether a pan took frames without planning since the last plan (`CandidateFinder.pan`). */
  private hasSkippedPlan = false;
  private lastCamera: Camera | undefined;
  private readonly isNeeded = (key: string): boolean =>
    this.planner.wants.get(key)?.isNeeded ?? false;
  private readonly isResident = (key: string): boolean =>
    this.parts.residency.get(key) !== undefined;
  private readonly assetOf = (assetId: AssetId): AssetView | undefined =>
    this.catalogue.peek(assetId)?.view;

  /**
   * Creates the manager; it loads nothing until images are tracked and a frame updates it.
   *
   * @param options - Backend, assets, jobs, ledger, budget and the frame request.
   */
  constructor(private readonly options: TextureManagerOptions) {
    const { catalogue } = options;
    this.catalogue = catalogue;
    this.stopListening = catalogue.listen((assetId) => {
      this.dirtyAssets.add(assetId);
      this.parts.loader.forgetFailures((key) => assetOfKey(key) === assetId);
      this.markStale();
    });
    this.parts = createTextureManagerParts(options, {
      onLoaded: (key, level, source) => {
        this.accept(key, level, source);
      },
      onDecoderMissing: (error) => {
        this.stats.decoderMissingFailures += 1;
        options.onDecoderMissing?.(error);
      },
      onEvicted: (key) => {
        this.stats.evictions += 1;
        this.dirtyAssets.add(assetOfKey(key));
      },
      onUploaded: (key) => {
        this.stats.uploads += 1;
        this.dirtyAssets.add(assetOfKey(key));
        imagePreviewOf(this)?.uploaded(key);
      },
      onAllocationFailed: () => {
        this.stats.allocationFailures += 1;
        imagePreviewOf(this)?.invalidate();
      },
      onPlaybackChanged: (assetId) => {
        this.dirtyAssets.add(assetId);
        this.markStale();
      },
      markStale: () => {
        this.markStale();
      },
    });
    registerImagePreview(
      this,
      new ImagePreviewTracker({
        catalogue,
        planner: this.planner,
        table: this.parts.table,
        residency: this.parts.residency,
        candidates: () => this.candidates.current,
        isPending: (key) => this.parts.loader.has(key),
        isQueued: (key) => this.parts.uploads.has(key),
        isReady: () =>
          !this.isStale && !this.hasSkippedPlan && this.dirtyAssets.size === 0 && this.isIdle,
      }),
    );
  }

  /**
   * Whether levels are being fetched or decoded.
   *
   * @returns True while any load is pending.
   */
  get isLoading(): boolean {
    return this.parts.loader.pendingCount > 0 || this.parts.playback.isLoading;
  }

  /**
   * Whether nothing is loading or waiting to upload: what golden scenes wait for.
   *
   * @returns True when idle.
   */
  get isIdle(): boolean {
    return !this.isLoading && this.parts.uploads.size === 0;
  }

  /**
   * Starts or keeps tracking an image object, or a shape's or frame's image paint, as
   * the scene prepared it. A new or changed one uses its asset (`AssetCatalogue.use`), and one
   * whose asset failed describes it again.
   *
   * @param target - The object and its world transform.
   * @param image - The residency image of the object's image paint; absent for an image object.
   */
  track(target: SceneObject, image?: ResidencyImage): void {
    const before = this.index.get(target.object.id);
    const version = this.index.version;
    const tracked = this.index.track(target, image);
    if (tracked === undefined || this.index.version === version) return;
    this.isStale = true;
    const { id, assetId } = tracked.object;
    imagePreviewOf(this)?.observe(assetId);
    if (before !== undefined && before.object.assetId !== assetId) {
      this.unlink(id, before.object.assetId);
    }
    const objects = this.objectsByAsset.get(assetId) ?? new Set();
    this.objectsByAsset.set(assetId, objects);
    if (!objects.has(id)) {
      objects.add(id);
      this.catalogue.use(assetId);
    }
    this.catalogue.describeAgainIfFailed(assetId);
    this.catalogue.revive(assetId);
  }

  /**
   * Stops tracking an object.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    const tracked = this.index.forget(id);
    if (tracked === undefined) return;
    this.isStale = true;
    this.unlink(id, tracked.object.assetId);
    this.parts.table.forget(id);
    this.planner.forget(id);
  }

  /**
   * What an image object's records draw now.
   *
   * @param id - The object.
   * @returns Its binding; a placeholder before the first update.
   */
  bindingOf(id: ObjectId): ImageBinding {
    return this.parts.table.bindingOf(this.index, id);
  }

  /**
   * What each record of an image draws, by level key (`photo|L512`, `photo|T4/15/0`) or
   * `placeholder`: for tests, golden reports and the overlay.
   *
   * @param id - The object.
   * @returns One entry per part of its binding.
   */
  shownKeys(id: ObjectId): string[] {
    return this.bindingOf(id).parts.map(({ source }) =>
      source === undefined ? 'placeholder' : this.parts.residency.keyAt(source.region),
    );
  }

  /**
   * The keys of every resident level and tile, for tests and golden reports.
   *
   * @returns The keys, in upload order.
   */
  residentKeys(): string[] {
    return this.parts.residency.keys();
  }

  /**
   * The bind group entries of a page.
   *
   * @param page - The page.
   * @returns Its texture and sampler.
   */
  pageEntries(page: number): readonly GpuBindGroupEntry[] {
    return this.parts.residency.pageEntries(page);
  }

  /**
   * Brings residency up to date for a frame: plans what the viewport wants, loads and cancels,
   * uploads within the budget, and rebinds images whose drawing changed. A still frame, or a pan
   * within the previous level bands inside the padded view with no event (`CandidateFinder.pan`) and no
   * candidate that may show tiles, plans nothing: it only counts what the visible images draw.
   * Loads keep the priority their last plan gave them until the next plan, which comes at the
   * latest when the camera rests: the first still frame after such a pan plans.
   *
   * Animated GIFs play after (`GifPlayback`), on this frame's candidates: one that starts or
   * stops makes the next frame plan, which rebinds its images, and a stopped one's slot is freed
   * once they are.
   *
   * @param frame - The frame's camera, viewport, index and time.
   * @returns The images to rewrite and the frame's image counts.
   */
  update(frame: ImageFrameInput): ImageFrameResult {
    // Images plan against what the text atlas borrows; the loan hears what they want.
    if (this.parts.uploads.refreshBudget()) this.markStale();
    const result = this.plan(frame);
    this.parts.uploads.reportDemand(this.planner.wantedBytes / LEVEL_PLAN_SHARE);
    const { playback } = this.parts;
    playback.settle();
    playback.update({
      candidates: this.candidates.current,
      candidateRevision: this.candidates.candidateRevision,
      zoom: frame.camera.zoom,
      timeMs: frame.timeMs,
      frameIndex: frame.frameIndex,
      isNeeded: this.isNeeded,
    });
    return result;
  }

  private plan(frame: ImageFrameInput): ImageFrameResult {
    const { lastCamera } = this;
    const { camera, viewport, timeMs } = frame;
    const priorityRevision = this.candidates.priorityRevision;
    this.lastCamera = camera;
    if (!this.isStale && lastCamera !== undefined) {
      // A camera at rest after movement that planned nothing plans once: the loads' priorities and
      // what came on screen are brought up to date.
      if (isSameCamera(lastCamera, camera) && !this.hasSkippedPlan) {
        this.candidates.remember(viewport, timeMs);
        return this.result([]);
      }
      if (
        (isSameScale(lastCamera, camera) || this.planner.canReuseScale(camera.zoom * camera.dpr)) &&
        !isSameCamera(lastCamera, camera) &&
        !this.planner.hasTileCandidates &&
        this.candidates.pan(this.index, viewport, timeMs)
      ) {
        this.hasSkippedPlan = true;
        if (priorityRevision !== this.candidates.priorityRevision)
          this.tally.recount(this.candidates.current);
        this.noteBlank();
        this.reportVisiblePending();
        return this.result([]);
      }
    }
    this.isStale = false;
    this.hasSkippedPlan = false;
    const candidates = this.candidates.find(this.index, viewport, timeMs);
    const needs = { candidates, assetOf: this.assetOf, isResident: this.isResident, viewport };
    const scale = { zoom: camera.zoom, dpr: camera.dpr };
    // While the text atlas borrows, what the images want is found first (ideal picks do not depend
    // on the budget; the probe picks from the real planner's last plans, so hysteresis matches)
    // and taken back before any load, flush, upload or rebind.
    if (this.parts.uploads.isLending()) {
      const previousPlan = (id: ObjectId): ObjectPlan | undefined => this.planner.planOf(id);
      this.demandProbe.plan({ ...needs, ...scale, budgetBytes: Infinity, previousPlan });
      this.parts.uploads.settleDemand(this.demandProbe.wantedBytes / LEVEL_PLAN_SHARE);
    }
    const budgetBytes = this.parts.residency.budgetBytes * LEVEL_PLAN_SHARE;
    this.planner.plan({ ...needs, ...scale, budgetBytes });
    const { wants } = this.planner;
    requestLevelLoads(this, this.parts, this.catalogue, wants);
    // Levels the byte cap held back go next frame; one the budget refused waits for the view.
    if (this.parts.uploads.upload(wants, frame.frameIndex, this.isNeeded)) this.markStale();
    for (const key of wants.keys()) {
      const resident = this.parts.residency.get(key);
      if (resident !== undefined) resident.lastUsedFrame = frame.frameIndex;
    }
    const rebound = this.parts.table.rebind({
      index: this.index,
      candidates,
      changed: this.planner.changed,
      dirtyAssets: this.dirtyAssets,
      objectsOf: (assetId) => this.objectsByAsset.get(assetId) ?? [],
      planOf: (id) => this.planner.planOf(id),
    });
    this.dirtyAssets.clear();
    this.catalogue.sweep();
    this.tally.assess(candidates, this.catalogue, this.parts.table.all);
    this.noteBlank();
    this.reportVisiblePending();
    return this.result(rebound);
  }

  /**
   * Frees every texture, cancels every load and stops every retry wait, so nothing asks for a
   * frame after; the catalogue lives on, and this manager's objects stop using their assets (a
   * manager rebuilt after a device loss uses them again before the catalogue's next sweep).
   * After a device loss the textures belong to a dead device, and destroying their handles is
   * harmless.
   */
  destroy(): void {
    imagePreviewOf(this)?.invalidate();
    this.stopListening();
    this.parts.loader.destroy();
    this.parts.playback.destroy();
    for (const [assetId, objects] of [...this.objectsByAsset]) {
      for (const id of [...objects]) this.unlink(id, assetId);
    }
    this.parts.residency.destroy();
  }

  /** Something changed that the next update must plan for: ask for a frame. */
  private markStale(): void {
    this.isStale = true;
    this.options.requestFrame();
  }

  private unlink(id: ObjectId, assetId: AssetId): void {
    const objects = this.objectsByAsset.get(assetId);
    if (objects?.delete(id) !== true) return;
    this.catalogue.release(assetId);
    if (objects.size === 0) {
      this.objectsByAsset.delete(assetId);
      imagePreviewOf(this)?.forget(assetId);
    }
  }

  private reportVisiblePending(): void {
    const { visiblePlaceholderAssets, nearPlaceholderAssets } = this.tally;
    this.pending.report(this.catalogue.assets, visiblePlaceholderAssets, nearPlaceholderAssets);
  }

  private noteBlank(): void {
    if (this.tally.counts.blank > 0) this.stats.blankImageFrames += 1;
  }

  private result(rebound: readonly SceneObject[]): ImageFrameResult {
    const { blank, placeholder, visible } = this.tally.counts;
    return { rebound, blankImages: blank, placeholderImages: placeholder, visibleImages: visible };
  }

  private accept(key: string, level: DecodedLevel, source: LevelSource): void {
    imagePreviewOf(this)?.loaded(key, source);
    if (this.catalogue.keepSmallest(source, level)) this.dirtyAssets.add(source.assetId);
    this.parts.uploads.add(key, level);
    this.markStale();
  }
}
