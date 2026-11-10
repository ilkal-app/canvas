import type { WorldBounds } from '../camera/camera.js';
import { BoundsVisibilityWitness } from '../spatial/bounds-visibility-witness.js';
import { intersectsBounds } from '../spatial/bounds.js';
import { isQueryReusable, padViewport } from '../spatial/padded-viewport.js';
import type { JobPriority } from '../workers/job-priority.js';

import type { ImageIndex, TrackedImage } from './image-index.js';
import type { ImageCandidate } from './image-needs.js';
import {
  PREFETCH_LOOKAHEAD_MS,
  prefetchReach,
  prefetchStrips,
  viewportVelocity,
} from './prefetch.js';

/**
 * The padding of the "near" region round the viewport, a fraction of its size per side: the
 * same as the scene's culler, so every record the frame draws belongs to a candidate.
 */
export const NEAR_PADDING = 0.25;

/** How far the prefetch region is moved ahead of the padded search, world units per axis. */
interface Reach {
  readonly x: number;
  readonly y: number;
}

/** No prefetch region. */
const NO_REACH: Reach = { x: 0, y: 0 };

/** A candidate the finder keeps between frames and updates in place. */
interface CandidateSlot extends ImageCandidate {
  image: TrackedImage;
  priority: JobPriority;
}

/**
 * Whether two lists hold the same images in the same order.
 *
 * @param first - One list.
 * @param second - The other.
 * @returns True when equal.
 */
function isSameList(first: readonly TrackedImage[], second: readonly TrackedImage[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

/**
 * Finds the images a frame cares about: `visible` on screen,
 * `near` in the padded viewport (drawn by the culler, and loaded before they scroll in), and
 * `prefetch` in the padded viewport moved along the pan velocity. It remembers the last
 * viewport to measure the velocity, and keeps its candidates between frames, updating them in
 * place, so a frame allocates nothing per image while the padded search is reused. On the
 * thread that renders.
 */
export class CandidateFinder {
  private lastViewport: WorldBounds | undefined;
  private lastTimeMs = 0;
  private priorityProof: BoundsVisibilityWitness | undefined;
  private priorityChanges = 0;
  private finds = 0;
  /** The last search of the padded viewport, reused while it still covers the view. */
  private query:
    | { readonly rect: WorldBounds; readonly version: number; readonly images: TrackedImage[] }
    | undefined;
  /** The candidates: the padded search's images, then the prefetch ones. */
  private readonly slots: CandidateSlot[] = [];
  /** How many of `slots` are the padded search's. */
  private queryCount = 0;
  /** The prefetch images of the last `find`, found `reach` ahead of the padded search. */
  private readonly prefetchImages: TrackedImage[] = [];
  /** How far ahead `prefetchImages` were found (`prefetchReach`, with its hysteresis). */
  private reach: Reach = NO_REACH;
  /** A pan's prefetch images, compared with the last `find`'s. */
  private readonly panPrefetch: TrackedImage[] = [];
  /** Scratch space for the index's search. */
  private readonly found: TrackedImage[] = [];

  /**
   * Reads classification changes; compare only across a successful same-candidate pan.
   *
   * @returns A revision advanced when an existing candidate's priority changes.
   */
  get priorityRevision(): number {
    return this.priorityChanges;
  }

  /**
   * A revision that changes with every `find`, which may change which images the candidates
   * are; a `pan` changes only their priorities, in place.
   *
   * @returns The revision.
   */
  get candidateRevision(): number {
    return this.finds;
  }

  /**
   * The candidates of the last `find` or `pan`: live, updated in place by the next.
   *
   * @returns The candidates.
   */
  get current(): readonly ImageCandidate[] {
    return this.slots;
  }

  /**
   * The candidates of one frame, each at its most urgent priority. The padded viewport's search
   * is reused, as the culler's is (`isQueryReusable`), while the view stays inside it and the
   * index is unchanged, so a zoom or a short pan searches nothing but the prefetch strips.
   *
   * @param index - The tracked images.
   * @param viewport - The visible world rectangle.
   * @param timeMs - The frame's time, ms.
   * @returns The candidates: live, updated in place by the next call.
   */
  find(index: ImageIndex, viewport: WorldBounds, timeMs: number): readonly ImageCandidate[] {
    this.finds += 1;
    let { query } = this;
    if (query?.version !== index.version || !isQueryReusable(query.rect, viewport, NEAR_PADDING)) {
      const rect = padViewport(viewport, NEAR_PADDING);
      query = { rect, version: index.version, images: index.search(rect) };
      this.query = query;
      this.queryCount = query.images.length;
      this.priorityProof = undefined;
      query.images.forEach((image, slot) => {
        this.slotAt(slot, image, 'near');
      });
    }
    this.updatePriorities(viewport);
    this.reach = this.reachOf(viewport, timeMs);
    this.collectPrefetch(index, this.reach, this.prefetchImages);
    this.slots.length = this.queryCount;
    this.prefetchImages.forEach((image, offset) => {
      this.slotAt(this.queryCount + offset, image, 'prefetch');
    });
    this.remember(viewport, timeMs);
    return this.slots;
  }

  /**
   * Takes a pan at an unchanged zoom that needs no planning, when it is one: the index is
   * unchanged, the view is still inside the padded search, and the prefetch region holds the
   * same images as last time. Then no image entered or left, so only the priorities change (on
   * screen or just off it, updated in place in `current`) and the frame is remembered;
   * otherwise nothing changes and the caller calls `find`. The prefetch region moves only when
   * the pan's speed changes enough (`prefetchReach`); while it stays, nothing is searched.
   * Allocates nothing per image.
   *
   * @param index - The tracked images.
   * @param viewport - The visible world rectangle.
   * @param timeMs - The frame's time, ms.
   * @returns Whether the pan was taken without planning.
   */
  pan(index: ImageIndex, viewport: WorldBounds, timeMs: number): boolean {
    const { query } = this;
    if (query?.version !== index.version || !isQueryReusable(query.rect, viewport, NEAR_PADDING)) {
      return false;
    }
    const reach = this.reachOf(viewport, timeMs);
    if (reach.x !== this.reach.x || reach.y !== this.reach.y) {
      this.collectPrefetch(index, reach, this.panPrefetch);
      if (!isSameList(this.panPrefetch, this.prefetchImages)) return false;
      this.reach = reach;
    }
    this.updatePriorities(viewport);
    this.remember(viewport, timeMs);
    return true;
  }

  /**
   * Notes a frame's viewport without searching: a frame that planned nothing still counts
   * towards the next frame's velocity.
   *
   * @param viewport - The visible world rectangle.
   * @param timeMs - The frame's time, ms.
   */
  remember(viewport: WorldBounds, timeMs: number): void {
    this.lastViewport = viewport;
    this.lastTimeMs = timeMs;
  }

  private slotAt(slot: number, image: TrackedImage, priority: JobPriority): void {
    const existing = this.slots[slot];
    if (existing === undefined) {
      this.slots[slot] = { image, priority };
      return;
    }
    existing.image = image;
    existing.priority = priority;
  }

  /**
   * Images on screen are visible; the rest of the padded search is near. A proof that no image
   * changes side (`BoundsVisibilityWitness`) is kept, so a later pan or zoom inside it, a
   * camera-only frame, classifies nothing.
   *
   * @param viewport - The visible world rectangle.
   */
  private updatePriorities(viewport: WorldBounds): void {
    if (this.priorityProof?.accepts(viewport)) return;
    const proof = new BoundsVisibilityWitness();
    let hasChanged = false;
    for (let index = 0; index < this.queryCount; index++) {
      const candidate = this.slots[index];
      if (!candidate) continue;
      const priority = proof.observe(viewport, candidate.image.bounds) ? 'visible' : 'near';
      hasChanged ||= candidate.priority !== priority;
      candidate.priority = priority;
    }
    this.priorityProof = proof;
    if (hasChanged) this.priorityChanges += 1;
  }

  /**
   * How far ahead of the padded search this frame prefetches, from the pan's velocity and the
   * last reach (`prefetchReach`). Allocates only when the reach changes.
   *
   * @param viewport - The visible world rectangle.
   * @param timeMs - The frame's time, ms.
   * @returns The reach.
   */
  private reachOf(viewport: WorldBounds, timeMs: number): Reach {
    const { query, lastViewport, reach } = this;
    if (query === undefined || lastViewport === undefined) return NO_REACH;
    const velocity = viewportVelocity(lastViewport, viewport, timeMs - this.lastTimeMs);
    const { rect } = query;
    const x = prefetchReach(velocity.x * PREFETCH_LOOKAHEAD_MS, reach.x, rect.maxX - rect.minX);
    const y = prefetchReach(velocity.y * PREFETCH_LOOKAHEAD_MS, reach.y, rect.maxY - rect.minY);
    return x === reach.x && y === reach.y ? reach : { x, y };
  }

  /**
   * The images in the prefetch region, `reach` ahead of the padded search, and outside it
   * (`prefetchStrips`), into a list.
   *
   * @param index - The tracked images.
   * @param reach - How far ahead.
   * @param into - Emptied, then filled.
   */
  private collectPrefetch(index: ImageIndex, reach: Reach, into: TrackedImage[]): void {
    into.length = 0;
    const { query } = this;
    if (query === undefined || (reach.x === 0 && reach.y === 0)) return;
    const { rect } = query;
    const ahead = {
      minX: rect.minX + reach.x,
      minY: rect.minY + reach.y,
      maxX: rect.maxX + reach.x,
      maxY: rect.maxY + reach.y,
    };
    const strips = prefetchStrips(rect, ahead);
    const [first] = strips;
    strips.forEach((strip, stripIndex) => {
      for (const image of index.search(strip, this.found)) {
        if (intersectsBounds(image.bounds, rect)) continue;
        // An image across both strips was taken with the first.
        if (stripIndex > 0 && first !== undefined && intersectsBounds(image.bounds, first))
          continue;
        into.push(image);
      }
    });
  }
}
