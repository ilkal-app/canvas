import type { BoardObject, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { SceneSource } from '../scene/scene-source.js';
import type { WorldTransform } from '../scene/world-transform.js';

import { unionBounds } from './bounds.js';
import {
  clipBounds,
  clipChainOf,
  type ClipChainMemo,
  type ClipRect,
  type OrientedBox,
} from './clip-chain.js';
import { drawnShapeOf } from './object-world-bounds.js';

/** What a clipped object draws before its clips cut it, and the clips that cut it. */
interface ClipEntry {
  /** Its world box before clipping (`worldBoundsOf`). */
  readonly base: WorldBounds;
  /** The shape it draws inside (`drawnShapeOf`), what the chain cuts. */
  readonly shape: WorldBounds | OrientedBox;
  /** Its clip chain (`clipChainOf`), not empty. */
  readonly chain: readonly ClipRect[];
}

/**
 * The clipping side of a `SceneSpatialIndex`: each clipped object's unclipped box and
 * clip chain, so its indexed box is what its clipping ancestors leave of it (its own drawing and
 * any drawing bounds the text pass adds alike), and the objects nothing is left of, which the
 * index leaves out. Objects nothing clips cost one map miss. Beside its index.
 */
export class ClippedBoxes {
  private readonly entries = new Map<ObjectId, ClipEntry>();
  private readonly away = new Set<ObjectId>();
  /** The frames that clip, so a board without one walks no ancestors for clips. */
  private readonly clippingFrames = new Set<ObjectId>();
  /** Clip chains of the containers met in the current apply, so siblings share one walk. */
  private memo: ClipChainMemo = new Map();

  /**
   * How many objects with a box their clips leave nothing of.
   *
   * @returns The count.
   */
  get awayCount(): number {
    return this.away.size;
  }

  /**
   * Whether an object has a box its clips leave nothing of.
   *
   * @param id - The object.
   * @returns True when it is clipped away.
   */
  isAway(id: ObjectId): boolean {
    return this.away.has(id);
  }

  /**
   * An object's world box before clipping, when its clips are recorded.
   *
   * @param id - The object.
   * @returns The box, or undefined for an object nothing clips.
   */
  baseOf(id: ObjectId): WorldBounds | undefined {
    return this.entries.get(id)?.base;
  }

  /**
   * Notes whether an object of a change set is a frame that clips, before any of the set's boxes
   * are worked out, so a child listed before its clipping frame is still clipped.
   *
   * @param id - The object.
   * @param object - The object now, or undefined when it is gone.
   */
  noteFrame(id: ObjectId, object: BoardObject | undefined): void {
    if (object?.type === 'frame' && object.clip) this.clippingFrames.add(id);
    else this.clippingFrames.delete(id);
  }

  /** Starts an apply: chains remembered from the last document state are dropped. */
  startApply(): void {
    if (this.memo.size > 0) this.memo = new Map();
  }

  /**
   * Records an object's box and the chain that clips it (`clipChainOf`, memoised per apply).
   *
   * @param object - The object.
   * @param transform - Its world transform.
   * @param base - Its world box (`worldBoundsOf`), finite.
   * @param source - The document, for its ancestors.
   */
  set(
    object: BoardObject,
    transform: WorldTransform,
    base: WorldBounds,
    source: SceneSource,
  ): void {
    const chain =
      object.parentId === null || this.clippingFrames.size === 0
        ? []
        : clipChainOf(object, source, this.memo);
    if (chain.length === 0) this.entries.delete(object.id);
    else this.entries.set(object.id, { base, shape: drawnShapeOf(object, transform, base), chain });
  }

  /**
   * Forgets an object that is gone or has no box.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.entries.delete(id);
    this.away.delete(id);
  }

  /**
   * Notes whether an object with a box is indexed or clipped away.
   *
   * @param id - The object.
   * @param isAway - True when its clips leave nothing of it.
   */
  markAway(id: ObjectId, isAway: boolean): void {
    if (isAway) this.away.add(id);
    else this.away.delete(id);
  }

  /**
   * The box to index for an object: its box and drawing bounds, each cut by its clip chain.
   *
   * @param id - The object.
   * @param base - Its world box before clipping.
   * @param extra - Drawing bounds the text pass reported, if any.
   * @returns The box, or undefined when its clips leave nothing.
   */
  boxOf(id: ObjectId, base: WorldBounds, extra: WorldBounds | undefined): WorldBounds | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return extra === undefined ? base : unionBounds(base, extra);
    const own = intersection(clipBounds(entry.shape, entry.chain), base);
    const drawn = extra && clipBounds(extra, entry.chain);
    return own && drawn ? unionBounds(own, drawn) : (own ?? drawn);
  }
}

/**
 * The overlap of two boxes.
 *
 * @param first - A box, or undefined for none.
 * @param second - Another box.
 * @returns Their overlap, or undefined when they do not overlap.
 */
function intersection(
  first: WorldBounds | undefined,
  second: WorldBounds,
): WorldBounds | undefined {
  if (first === undefined) return undefined;
  const minX = Math.max(first.minX, second.minX);
  const minY = Math.max(first.minY, second.minY);
  const maxX = Math.min(first.maxX, second.maxX);
  const maxY = Math.min(first.maxY, second.maxY);
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : undefined;
}
