import type { ObjectId } from '@canvas/schema';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { budgetForDevice } from '../memory/device-budget.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import type { SceneObject, ScenePassEnvironment } from '../scene/scene-pass.js';

import {
  createImagePassSupport,
  NO_IMAGE_ASSETS,
  type ImagePassSupport,
} from './image-pass-support.js';
import { imagePreviewOf } from './image-preview-registry.js';
import type { ImageJobRunner } from './level-loader.js';
import type { ResidencyImage } from './residency-image.js';
import { TextureManager } from './texture-manager.js';

// One texture manager per renderer: the image pass and the image-fill passes share it, so
// an image object and a shape's or frame's image paint compete in one residency under one
// `textures` budget, with one set of ledger entries, and "the smallest level of every visible image
// is always resident" covers both. One frame stage updates it and hands each pass the records it
// must rewrite.

/** The name of the shared frame stage, after `collectChanges`. */
export const IMAGE_STAGE_NAME = 'images';

/**
 * The time slice a frame gives `decode` jobs on the thread that renders, ms, when the pool has no
 * workers (a browser that cannot start them from the engine's thread; tests).
 */
const DECODE_SLICE_MS = 4;

/** No asset source can produce bytes, so this shared runner never has a job or a queue. */
const NO_JOBS: ImageJobRunner = {
  submit: () => {
    throw new Error('An image pass without assets cannot submit decode jobs.');
  },
  cancel: () => false,
  setPriority: () => false,
};

/** A pass that draws from the shared residency. */
export interface ResidencyHolder {
  /** The pass's name: its records are rewritten under it. */
  readonly passName: string;
  /** The targets the pass prepared, by id: rewritten when their level-of-detail form changes. */
  readonly targets: ReadonlyMap<ObjectId, SceneObject>;
  /**
   * The scene's target a tracked one draws for: itself, or the object whose part a stand-in is;
   * undefined when the pass no longer draws it. Absent: the tracked target itself.
   */
  readonly sceneTargetOf?: (tracked: SceneObject) => SceneObject | undefined;
}

/** Each environment's residency: a renderer builds one environment for all its passes. */
const residencies = new WeakMap<ScenePassEnvironment, SharedImageResidency>();

/**
 * The texture manager a renderer's image-drawing passes share, created on first use (a board
 * without images or image paints allocates nothing), and destroyed when the last pass leaves.
 * On the thread that renders.
 */
export class SharedImageResidency {
  /** The passes using it, by name. */
  private readonly holders = new Map<string, ResidencyHolder>();
  /** Which pass each tracked object belongs to: its records are rewritten under that pass. */
  private readonly owners = new Map<ObjectId, string>();
  private created: TextureManager | undefined;
  private isInstalled = false;
  private readonly rewrites = new Map<string, Set<SceneObject>>();

  private constructor(
    private readonly environment: ScenePassEnvironment,
    /** The catalogue and decode pool the manager reads. */
    readonly support: ImagePassSupport,
  ) {}

  /**
   * The residency of a renderer's environment, joined by a pass.
   *
   * @param environment - The renderer's pass environment.
   * @param holder - The pass.
   * @returns The residency.
   */
  static join(environment: ScenePassEnvironment, holder: ResidencyHolder): SharedImageResidency {
    let residency = residencies.get(environment);
    if (residency === undefined) {
      const { maxTextureSize } = environment.backend.capabilities;
      const support =
        environment.images ?? createImagePassSupport(NO_IMAGE_ASSETS, NO_JOBS, maxTextureSize);
      residency = new SharedImageResidency(environment, support);
      residencies.set(environment, residency);
    }
    residency.holders.set(holder.passName, holder);
    return residency;
  }

  /**
   * The texture manager, created on first use on the environment's backend under its `textures`
   * budget, reporting to its ledger; the support's `onManager` hears of it once.
   *
   * @returns The manager.
   */
  get manager(): TextureManager {
    if (this.created === undefined) {
      const { environment, support } = this;
      const { maxTextureSize } = environment.backend.capabilities;
      this.created = new TextureManager({
        backend: environment.backend,
        catalogue: support.catalogue,
        jobs: support.jobs,
        ledger: environment.ledger ?? new MemoryLedger(),
        budget:
          environment.budget ??
          budgetForDevice({ deviceMemoryGb: undefined, maxTextureSize, isMobile: false }),
        ...(environment.atlasLoan === undefined ? {} : { atlasLoan: environment.atlasLoan }),
        requestFrame: environment.requestFrame,
        onDecoderMissing: support.reportDecoderMissing,
      });
      support.onManager?.(this.created);
    }
    return this.created;
  }

  /**
   * Whether the manager exists yet.
   *
   * @returns True once a pass has used it.
   */
  get isCreated(): boolean {
    return this.created !== undefined;
  }

  /**
   * Tracks an image for a pass: an image object as it is, or a shape's or frame's image paint as
   * `image`.
   *
   * @param holder - The pass.
   * @param target - The scene object.
   * @param image - The residency image of its image paint; absent for an image object.
   */
  track(holder: ResidencyHolder, target: SceneObject, image?: ResidencyImage): void {
    this.owners.set(target.object.id, holder.passName);
    this.manager.track(target, image);
  }

  /**
   * Stops tracking an object for a pass; an object another pass now owns stays tracked.
   *
   * @param holder - The pass.
   * @param id - The object.
   */
  forget(holder: ResidencyHolder, id: ObjectId): void {
    if (this.owners.get(id) !== holder.passName) return;
    this.owners.delete(id);
    this.created?.forget(id);
  }

  /**
   * Installs the shared frame stage, once whatever pass asks first.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    if (this.isInstalled) return;
    this.isInstalled = true;
    frame.insertStage('after', 'collectChanges', {
      name: IMAGE_STAGE_NAME,
      run: (context) => {
        this.runFrame(context);
      },
    });
  }

  /**
   * A pass leaves; the last to leave destroys the manager.
   *
   * @param holder - The pass.
   */
  leave(holder: ResidencyHolder): void {
    if (!this.holders.delete(holder.passName)) return;
    if (this.holders.size > 0) return;
    this.created?.destroy();
    this.created = undefined;
    residencies.delete(this.environment);
  }

  /**
   * The frame stage: updates the manager once, rewrites each pass's records whose binding or
   * level-of-detail form changed, counts the images drawn, and gives decode jobs a slice when the
   * pool has no workers.
   *
   * @param context - The frame.
   * @throws {Error} What the manager's update throws, after invalidating the preview.
   */
  private runFrame(context: FrameContext): void {
    const manager = this.created;
    if (manager === undefined) return;
    const { camera, viewport, frameIndex, timeMs } = context;
    let result;
    try {
      result = manager.update({ camera, viewport, frameIndex, timeMs });
    } catch (error) {
      imagePreviewOf(manager)?.invalidate();
      throw error;
    }
    for (const target of result.rebound) {
      const owner = this.owners.get(target.object.id);
      if (owner === undefined) continue;
      const holder = this.holders.get(owner);
      const scene = holder?.sceneTargetOf === undefined ? target : holder.sceneTargetOf(target);
      if (scene !== undefined) this.rewritesOf(owner).add(scene);
    }
    for (const holder of this.holders.values()) {
      for (const id of context.scene.levelOfDetail.changedIn(holder.passName)) {
        const target = holder.targets.get(id);
        if (target !== undefined) this.rewritesOf(holder.passName).add(target);
      }
    }
    for (const [passName, targets] of this.rewrites) {
      if (targets.size > 0) context.scene.rewriteRecords(passName, targets);
      targets.clear();
    }
    imagePreviewOf(manager)?.finish(camera, frameIndex);
    context.stats.blankImages += result.blankImages;
    context.stats.placeholderImages += result.placeholderImages;
    context.stats.visibleImages += result.visibleImages;
    if (!manager.isLoading) return;
    const drained = this.support.jobs.drainMainThread?.(DECODE_SLICE_MS, this.environment.now);
    if (drained !== undefined && drained.jobsRemaining > 0) this.environment.requestFrame();
  }

  /**
   * The set of records a pass rewrites this frame.
   *
   * @param passName - The pass.
   * @returns Its set, reused from frame to frame.
   */
  private rewritesOf(passName: string): Set<SceneObject> {
    let set = this.rewrites.get(passName);
    if (set === undefined) {
      set = new Set();
      this.rewrites.set(passName, set);
    }
    return set;
  }
}
