import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { SceneObject } from '../scene/scene-pass.js';
import type { WorldTransform } from '../scene/world-transform.js';
import { worldBoundsOf } from '../spatial/object-world-bounds.js';
import { checkBounds } from '../spatial/r-tree-node.js';
import { RTree } from '../spatial/r-tree.js';

import type { ResidencyImage } from './residency-image.js';

/**
 * An image the texture manager tracks: an image object, or a shape's or frame's image paint,
 * as the scene last prepared it, and where it is.
 */
export interface TrackedImage {
  /** The image: the image object itself, or its paint's residency image. */
  readonly object: ResidencyImage;
  /** The scene object it was prepared from, whose records are rewritten when it rebinds. */
  readonly target: SceneObject;
  /** Its frame to the world. */
  readonly transform: WorldTransform;
  /** Its world bounds. */
  readonly bounds: WorldBounds;
}

/**
 * The image objects of the scene in an R-tree of their own (`RTree`): the
 * texture manager asks it each frame which images the viewport, the padded viewport and the
 * prefetch region hold, without walking the scene's instance ranges. Fed by the image pass's
 * `prepare` and `forget`. On the thread that renders.
 */
export class ImageIndex {
  private readonly tree = new RTree();
  /** Bounds copied at track time; queries flush the complete pending batch. */
  private readonly pending = new Map<ObjectId, WorldBounds>();
  private readonly byId = new Map<ObjectId, TrackedImage>();
  private revision = 0;
  /** Scratch space for the tree's search, reused. */
  private readonly foundIds: ObjectId[] = [];

  /**
   * Changes whenever an image is added, removed, moved or changed: equal versions, equal index.
   *
   * @returns The version.
   */
  get version(): number {
    return this.revision;
  }

  /**
   * Records an image as the scene prepared it: an image object as it is, or a shape's or frame's
   * image paint as `image`; any other object without an `image` is ignored.
   *
   * @param target - The object and its world transform.
   * @param image - The residency image of the object's image paint; absent for an image object.
   * @returns The tracked image, or undefined when there is no image or no bounds.
   */
  track(target: SceneObject, image?: ResidencyImage): TrackedImage | undefined {
    const { object, transform } = target;
    const shown = image ?? (object.type === 'image' ? object : undefined);
    if (shown === undefined) return undefined;
    // The same object, image and transform (a record rewritten for a new level) change nothing.
    const previous = this.byId.get(object.id);
    if (
      previous?.target.object === object &&
      previous.object === shown &&
      previous.transform === transform
    ) {
      return previous;
    }
    const bounds = worldBoundsOf(object, transform);
    if (bounds === undefined) return undefined;
    const tracked: TrackedImage = { object: shown, target, transform, bounds };
    this.byId.set(object.id, tracked);
    checkBounds(bounds);
    this.pending.set(object.id, { ...bounds });
    this.revision += 1;
    return tracked;
  }

  /**
   * Stops tracking an object.
   *
   * @param id - The object.
   * @returns The image it was, if tracked.
   */
  forget(id: ObjectId): TrackedImage | undefined {
    const tracked = this.byId.get(id);
    if (tracked === undefined) return undefined;
    this.byId.delete(id);
    this.pending.delete(id);
    this.tree.remove(id);
    this.revision += 1;
    return tracked;
  }

  /**
   * One tracked image.
   *
   * @param id - The object.
   * @returns The image, or undefined.
   */
  get(id: ObjectId): TrackedImage | undefined {
    return this.byId.get(id);
  }

  /**
   * The images whose bounds meet a region.
   *
   * @param region - The region, world units.
   * @param into - Where to put them (emptied first); a new array by default, so a caller that
   *   searches every frame can reuse one.
   * @returns `into`, holding the images in no particular order.
   */
  search(region: WorldBounds, into: TrackedImage[] = []): TrackedImage[] {
    if (this.pending.size > 0) {
      this.tree.updateMany([...this.pending].map(([key, bounds]) => ({ key, bounds })));
      this.pending.clear();
    }
    into.length = 0;
    const ids = this.tree.searchRect(region, this.foundIds);
    for (const id of ids) {
      const tracked = this.byId.get(id);
      if (tracked !== undefined) into.push(tracked);
    }
    ids.length = 0;
    return into;
  }
}
