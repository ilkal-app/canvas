import type { BoardObject, ImagePaint, ObjectId } from '@canvas/schema';

import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { Frame } from '../scene/frame.js';
import { registerRootMoveBatchGuard } from '../scene/root-move-batch-guards.js';
import type { SceneObject, ScenePass, ScenePassEnvironment } from '../scene/scene-pass.js';

import { pageOfImageFill, writeImageFillTail } from './image-fill-record.js';
import { registerImagePassPreview } from './image-preview-registry.js';
import { paintResidencyImage, type ResidencyImage } from './residency-image.js';
import { SharedImageResidency, type ResidencyHolder } from './shared-image-residency.js';

// What an image-fill pass keeps: the shared residency it draws from,
// the targets it prepared (rewritten when their level or form changes), and each object
// version's residency image, so a frame that rewrites a record does not lay its paint out again.

/**
 * One image-fill pass's share of the renderer's texture manager: it tracks each object's image
 * paint as a `ResidencyImage`, writes the image-fill tail and placeholder colour of its record,
 * and tells the scene which page a record draws from. On the thread that renders.
 */
export class ImageFillRecords {
  /** Each object's last target, by id. */
  private readonly targets = new Map<ObjectId, SceneObject>();
  private readonly holder: ResidencyHolder;
  private readonly residency: SharedImageResidency;
  /** Each object version's residency image: objects are immutable values. */
  private readonly images = new WeakMap<BoardObject, ResidencyImage>();
  /** The id each object's fill is tracked under, where it is not the object's own. */
  private readonly trackedIds = new Map<ObjectId, ObjectId>();
  /** The object each such tracked id draws for. */
  private readonly sceneIds = new Map<ObjectId, ObjectId>();

  /**
   * Joins the renderer's shared residency for a pass.
   *
   * @param passName - The pass's name: its records are rewritten under it.
   * @param environment - The renderer's environment.
   * @param paintOf - The object's image paint, or undefined when the pass does not draw it.
   * @param placementOf - Where the fill draws: the target itself (its box from its corner), or,
   *   for a fill in part of an object (a link card's preview and icon), a stand-in
   *   whose object is the part's box, under its own id when the object draws two fills, and
   *   whose transform places the part. Stand-ins are kept per object version and transform, so
   *   an unchanged object gives the same one.
   */
  constructor(
    private readonly passName: string,
    private readonly environment: ScenePassEnvironment,
    private readonly paintOf: (object: BoardObject) => ImagePaint | undefined,
    private readonly placementOf: (target: SceneObject) => SceneObject = (target) => target,
  ) {
    this.holder = {
      passName,
      targets: this.targets,
      sceneTargetOf: (tracked) =>
        this.targets.get(this.sceneIds.get(tracked.object.id) ?? tracked.object.id),
    };
    this.residency = SharedImageResidency.join(environment, this.holder);
  }

  /**
   * Tracks an object's image paint and writes its record's placeholder colour (floats 4 to 7)
   * and image-fill tail. A target the pass does not draw is left alone.
   *
   * @param record - The record, its leading record already written.
   * @param target - The object and its transform.
   * @param offset - Where the tail starts.
   */
  write(record: Float32Array, target: SceneObject, offset: number): void {
    const { object } = target;
    const paint = this.paintOf(object);
    if (paint === undefined || !('width' in object)) return;
    this.retain(target);
    const placed = this.placementOf(target).object;
    const { manager } = this.residency;
    const binding = manager.bindingOf(placed.id);
    const isAverage =
      this.environment.levelOfDetail?.formOf(this.passName, object.id) === 'average-color';
    record.set(binding.color, 4);
    writeImageFillTail(
      record,
      offset,
      'width' in placed ? placed : object,
      paint,
      binding,
      isAverage,
    );
  }

  /**
   * Tracks a target without writing a record: a root move's moved object.
   *
   * @param target - The object and its transform.
   */
  retain(target: SceneObject): void {
    const { object } = target;
    const paint = this.paintOf(object);
    if (paint === undefined || !('width' in object)) return;
    const placed = this.placementOf(target);
    const box = 'width' in placed.object ? placed.object : object;
    let image = this.images.get(placed.object);
    if (image === undefined) {
      image = paintResidencyImage(placed.object.id, paint, box);
      this.images.set(placed.object, image);
    }
    this.residency.track(this.holder, placed, image);
    this.targets.set(object.id, target);
    if (placed.object.id !== object.id) {
      this.trackedIds.set(object.id, placed.object.id);
      this.sceneIds.set(placed.object.id, object.id);
    }
  }

  /**
   * The page a target's record draws from: its level's, or the placeholder page. The average
   * colour stays on its level's page, so a form change moves no record between pages.
   *
   * @param target - The object.
   * @returns The page.
   */
  pageOf(target: SceneObject): number {
    const placed = this.placementOf(target).object;
    return pageOfImageFill(this.residency.manager.bindingOf(placed.id));
  }

  /**
   * A page's bindings: its texture and sampler.
   *
   * @param page - The page.
   * @returns Its entries.
   */
  pageEntries(page: number): readonly GpuBindGroupEntry[] {
    return this.residency.manager.pageEntries(page);
  }

  /**
   * Installs the shared frame stage (once per renderer).
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    this.residency.install(frame);
  }

  /**
   * Stops tracking an object.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    const tracked = this.trackedIds.get(id);
    this.residency.forget(this.holder, tracked ?? id);
    this.targets.delete(id);
    if (tracked !== undefined) {
      this.trackedIds.delete(id);
      this.sceneIds.delete(tracked);
    }
  }

  /** Leaves the shared residency; the last pass to leave destroys it. */
  destroy(): void {
    this.residency.leave(this.holder);
  }

  /**
   * Registers a pass as a contributor to the renderer's preview certificate: its fills are in its
   * manager's evidence, and it refuses while one draws its average colour.
   *
   * @param pass - The pass.
   * @returns The pass.
   */
  registerPreview(pass: ScenePass): ScenePass {
    const { residency, environment, passName, targets } = this;
    registerImagePassPreview(
      pass,
      () => (residency.isCreated ? residency.manager : undefined),
      () =>
        [...targets.keys()].every(
          (id) => environment.levelOfDetail?.formOf(passName, id) !== 'average-color',
        ),
    );
    return pass;
  }

  /**
   * Refuses root-move batches in which a moved object's image paint changed asset or its asset is
   * not yet described, so a move never calls the asset hooks synchronously (as the image pass).
   *
   * @param pass - The pass.
   * @returns The pass.
   */
  guardRootMoves(pass: ScenePass): ScenePass {
    const { catalogue } = this.residency.support;
    registerRootMoveBatchGuard(pass, (objects) =>
      objects.every((object) => {
        const paint = this.paintOf(object);
        if (paint === undefined) return true;
        const previous = this.targets.get(object.id)?.object;
        const previousPaint = previous === undefined ? undefined : this.paintOf(previous);
        return (
          previousPaint?.assetId === paint.assetId &&
          catalogue.peek(paint.assetId)?.status === 'described'
        );
      }),
    );
    return pass;
  }
}
