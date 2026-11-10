import type { AssetId, ObjectId } from '@canvas/schema';

import type { SceneObject } from '../scene/scene-pass.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import { bindImage } from './bind-image.js';
import {
  isSameBinding,
  placeholderBinding,
  UNKNOWN_IMAGE_COLOR,
  type ImageBinding,
} from './image-binding.js';
import type { ImageIndex } from './image-index.js';
import type { ImageCandidate, ObjectPlan } from './image-needs.js';
import type { ResidentLevel } from './texture-residency.js';

/** What the table rebinds from: the frame's plans and what changed. */
export interface RebindInput {
  /** The tracked images. */
  readonly index: ImageIndex;
  /** The frame's candidates: those not bound yet are bound. */
  readonly candidates: readonly ImageCandidate[];
  /** The images whose plan changed. */
  readonly changed: readonly ObjectId[];
  /** The assets whose residency or description changed: all their images are rebound. */
  readonly dirtyAssets: Iterable<AssetId>;
  /**
   * The images of an asset.
   *
   * @param assetId - The asset.
   * @returns Their ids.
   */
  objectsOf(assetId: AssetId): Iterable<ObjectId>;
  /**
   * An image's plan this frame.
   *
   * @param id - The object.
   * @returns Its plan, or undefined when it is not a candidate.
   */
  planOf(id: ObjectId): ObjectPlan | undefined;
}

/**
 * What each image object draws (`ImageBinding`) and the level it last
 * picked, recomputed only for images whose plan, asset or residency changed: the texture
 * manager's bindings, which the image pass's records are written from. Its scratch set is kept
 * between frames. On the thread that renders.
 */
export class BindingTable {
  private readonly bindings = new Map<ObjectId, ImageBinding>();
  private readonly pickedLevels = new Map<ObjectId, number>();
  private readonly ids = new Set<ObjectId>();

  /**
   * Creates an empty table.
   *
   * @param catalogue - The assets.
   * @param residentOf - Looks up what an image draws for a resident level, by key and image (a
   *   playing GIF's image draws its slot, `GifPlayback.shownFor`).
   */
  constructor(
    private readonly catalogue: AssetCatalogue,
    private readonly residentOf: (key: string, id: ObjectId) => ResidentLevel | undefined,
  ) {}

  /**
   * Every image's binding, for counting blank images.
   *
   * @returns The bindings, by object.
   */
  get all(): ReadonlyMap<ObjectId, ImageBinding> {
    return this.bindings;
  }

  /**
   * What an image draws now: its binding, or, before its first, what its asset and last pick
   * give.
   *
   * @param index - The tracked images.
   * @param id - The object.
   * @returns Its binding; a placeholder for an image not tracked.
   */
  bindingOf(index: ImageIndex, id: ObjectId): ImageBinding {
    const binding = this.bindings.get(id);
    if (binding !== undefined) return binding;
    const tracked = index.get(id);
    if (tracked === undefined) return placeholderBinding(UNKNOWN_IMAGE_COLOR);
    const entry = this.catalogue.peek(tracked.object.assetId);
    return bindImage(tracked.object, entry, undefined, this.pickedLevels.get(id), (key) =>
      this.residentOf(key, id),
    );
  }

  /**
   * Forgets an image.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.bindings.delete(id);
    this.pickedLevels.delete(id);
  }

  /**
   * Recomputes the bindings that may have changed: candidates whose plan is new this frame or
   * that have none yet, and every image of an asset whose residency or description changed.
   * The rest keep theirs.
   *
   * @param input - The frame's plans and what changed.
   * @returns The images whose binding changed.
   */
  rebind(input: RebindInput): SceneObject[] {
    const { ids } = this;
    ids.clear();
    for (const id of input.changed) {
      ids.add(id);
      const plan = input.planOf(id);
      if (plan !== undefined) this.pickedLevels.set(id, plan.pickedLevel);
    }
    for (const { image } of input.candidates) {
      if (!this.bindings.has(image.object.id)) ids.add(image.object.id);
    }
    for (const assetId of input.dirtyAssets) {
      for (const id of input.objectsOf(assetId)) ids.add(id);
    }
    const rebound: SceneObject[] = [];
    for (const id of ids) {
      const tracked = input.index.get(id);
      if (tracked === undefined) continue;
      const entry = this.catalogue.peek(tracked.object.assetId);
      const plan = input.planOf(id);
      const picked = this.pickedLevels.get(id);
      const next = bindImage(tracked.object, entry, plan, picked, (key) =>
        this.residentOf(key, id),
      );
      const previous = this.bindings.get(id);
      if (previous !== undefined && isSameBinding(previous, next)) continue;
      this.bindings.set(id, next);
      rebound.push(tracked.target);
    }
    return rebound;
  }
}
