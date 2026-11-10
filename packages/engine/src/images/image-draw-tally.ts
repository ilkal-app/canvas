import type { AssetId, ObjectId } from '@canvas/schema';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { BindingPart, ImageBinding } from './image-binding.js';
import type { ImageCandidate } from './image-needs.js';

/** How a frame's visible images were drawn. */
export interface ImageDrawCounts {
  /** Visible images. */
  visible: number;
  /**
   * Visible images of assets that were ready once drawn without a texture: the "never blank"
   * rule keeps it at 0.
   */
  blank: number;
  /** Visible images drawn from their placeholder because nothing of their asset ever loaded. */
  placeholder: number;
}

/**
 * Whether a part of a binding draws from a texture.
 *
 * @param part - The part.
 * @returns True when it has a source.
 */
function hasTexture(part: BindingPart): boolean {
  return part.source !== undefined;
}

/** A candidate drawn wholly from textures. */
const TEXTURED = 0;
/** A candidate of an asset that was ready once, with a part drawn without a texture. */
const BLANK = 1;
/** A candidate of an asset that never loaded, on its placeholder. */
const PLACEHOLDER = 2;

/**
 * Counts how a frame's visible images were drawn: every
 * visible candidate; those with a part drawn without a texture, as blank when their asset was
 * ever ready (its smallest level decoded; the flag is sticky, so a dropped CPU copy hides
 * nothing) and as placeholder otherwise. `assess` works out how each candidate draws after a
 * plan; a pan that changed only which candidates are visible `recount`s from that, reading no
 * binding. Its scratch array is kept between frames, so neither allocates. On the thread that
 * renders.
 */
export class ImageDrawTally {
  /** The last counts. */
  readonly counts: ImageDrawCounts = { visible: 0, blank: 0, placeholder: 0 };
  /**
   * The assets of the last counted visible images drawn from their placeholder (the
   * adapter polls for them first). The same set, cleared and refilled by each count.
   */
  readonly visiblePlaceholderAssets = new Set<AssetId>();
  /**
   * The assets of the last counted candidates near the view or ahead of the pan (not visible)
   * drawn from their placeholder (fix round 2: the adapter describes them next, before
   * the rest of the board). The same set, cleared and refilled by each count.
   */
  readonly nearPlaceholderAssets = new Set<AssetId>();
  private states = new Uint8Array(0);

  /**
   * Works out how each candidate draws and counts the visible ones.
   *
   * @param candidates - The frame's candidates.
   * @param catalogue - The assets.
   * @param bindings - What each image draws.
   */
  assess(
    candidates: readonly ImageCandidate[],
    catalogue: AssetCatalogue,
    bindings: ReadonlyMap<ObjectId, ImageBinding>,
  ): void {
    if (this.states.length < candidates.length) {
      this.states = new Uint8Array(Math.max(candidates.length, this.states.length * 2));
    }
    const { states } = this;
    candidates.forEach(({ image }, index) => {
      const binding = bindings.get(image.object.id);
      if (binding?.parts.every(hasTexture) === true) states[index] = TEXTURED;
      else if (catalogue.peek(image.object.assetId)?.hasBeenReady === true) states[index] = BLANK;
      else states[index] = PLACEHOLDER;
    });
    this.recount(candidates);
  }

  /**
   * Counts the visible candidates again from the last `assess`: the candidates are the same and
   * draw the same, only which of them are visible changed.
   *
   * @param candidates - The candidates `assess` saw, with their priorities now.
   */
  recount(candidates: readonly ImageCandidate[]): void {
    const { counts, states } = this;
    counts.visible = 0;
    counts.blank = 0;
    counts.placeholder = 0;
    this.visiblePlaceholderAssets.clear();
    this.nearPlaceholderAssets.clear();
    candidates.forEach(({ priority, image }, index) => {
      const state = states[index];
      if (priority !== 'visible') {
        if (state === PLACEHOLDER) this.nearPlaceholderAssets.add(image.object.assetId);
        return;
      }
      counts.visible += 1;
      if (state === BLANK) counts.blank += 1;
      else if (state === PLACEHOLDER) {
        counts.placeholder += 1;
        this.visiblePlaceholderAssets.add(image.object.assetId);
      }
    });
  }
}
