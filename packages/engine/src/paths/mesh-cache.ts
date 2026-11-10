import { EvictionMemory } from '../memory/eviction-memory.js';

/** What the cache needs to know of a mesh: the GPU bytes it holds. */
export interface CachedMesh {
  /** The mesh's size in GPU memory, bytes. */
  readonly byteLength: number;
}

/** How a {@link MeshCache} is set up. */
export interface MeshCacheOptions<TMesh extends CachedMesh> {
  /**
   * The cap, bytes: the `meshes` share of the device's GPU memory budget. Meshes drawn in the
   * current frame are never evicted, so a frame that needs more than the cap goes over it until
   * those meshes go off screen.
   */
  readonly byteBudget: number;
  /**
   * Called with every mesh the cache lets go (evicted, replaced, superseded by a newer version
   * or deleted), so its GPU buffer can be freed.
   */
  readonly onDrop?: (mesh: TMesh) => void;
}

/** One cached mesh and when it was last drawn. */
interface CacheEntry<TMesh> {
  readonly objectId: string;
  readonly version: number;
  readonly bucket: number;
  readonly mesh: TMesh;
  /** The cache frame it was last drawn in. */
  usedFrame: number;
}

/**
 * Path meshes per object, network version and zoom bucket, under a byte budget, the GPU
 * memory budget's `meshes` share (off-screen objects' meshes are the first to go). A version
 * stands for the network's content: a move keeps it, an edit bumps it, and a mesh of a newer
 * version drops the object's older ones. Eviction is least recently drawn first and never
 * touches a mesh drawn in the current frame, so what goes first is off screen, or an old bucket
 * nobody draws any more. Keeps no GPU state itself: `onDrop` frees what a mesh holds. One
 * thread; not shared.
 */
export class MeshCache<TMesh extends CachedMesh> {
  private readonly budget: number;
  private readonly onDrop: ((mesh: TMesh) => void) | undefined;
  /** Every entry, least recently drawn first (a `Set` keeps insertion order). */
  private readonly recency = new Set<CacheEntry<TMesh>>();
  private readonly entriesByObject = new Map<string, CacheEntry<TMesh>[]>();
  private frame = 0;
  private activeCount = 0;
  private bytes = 0;
  private evictionCount = 0;
  /** What was evicted lately, to count meshes built again soon after. */
  private readonly evictionMemory = new EvictionMemory();
  /** The current frame's time, ms, from `beginFrame`. */
  private timeMs = 0;

  /**
   * Creates an empty cache.
   *
   * @param options - The byte budget and the drop callback.
   * @throws {RangeError} When the budget is negative or not a number.
   */
  constructor(options: MeshCacheOptions<TMesh>) {
    if (!(options.byteBudget >= 0)) {
      throw new RangeError(`A mesh cache needs a budget ≥ 0; got ${String(options.byteBudget)}.`);
    }
    this.budget = options.byteBudget;
    this.onDrop = options.onDrop;
  }

  /**
   * The bytes of every cached mesh.
   *
   * @returns The total, bytes.
   */
  get byteLength(): number {
    return this.bytes;
  }

  /**
   * The cap the cache evicts down to.
   *
   * @returns The budget, bytes.
   */
  get byteBudget(): number {
    return this.budget;
  }

  /**
   * Whether the meshes drawn this frame alone exceed the budget.
   *
   * @returns True when over.
   */
  get isOverBudget(): boolean {
    return this.bytes > this.budget;
  }

  /**
   * How many meshes are cached.
   *
   * @returns The count.
   */
  get size(): number {
    return this.recency.size;
  }

  /**
   * How many meshes were evicted for the budget since the cache was created.
   *
   * @returns The count.
   */
  get evictions(): number {
    return this.evictionCount;
  }

  /**
   * Starts a frame: from now on only meshes looked up or set are "drawn this frame".
   *
   * @param timeMs - The frame's time, ms, for counting regenerations; default the last frame's.
   * @param shouldRetainUsed - Keep the previous active set when a caller proved the drawn meshes
   *   are unchanged. Time pruning and subsequent trimming still run normally.
   */
  beginFrame(timeMs: number = this.timeMs, shouldRetainUsed = false): void {
    if (!shouldRetainUsed) {
      this.frame += 1;
      this.activeCount = 0;
    }
    this.timeMs = timeMs;
    this.evictionMemory.prune(timeMs);
  }

  /**
   * Meshes cached again within `REGENERATION_WINDOW_MS` of their eviction, since the cache was
   * created ('s no-thrash counter).
   *
   * @returns The count.
   */
  get regenerations(): number {
    return this.evictionMemory.regenerations;
  }

  /**
   * The mesh of exactly this object, version and bucket, marked as drawn this frame.
   *
   * @param objectId - The path object.
   * @param version - Its network's version.
   * @param bucket - The zoom bucket.
   * @returns The mesh, or `undefined` when it is not cached.
   */
  get(objectId: string, version: number, bucket: number): TMesh | undefined {
    const entry = this.entriesByObject
      .get(objectId)
      ?.find((candidate) => candidate.version === version && candidate.bucket === bucket);
    if (!entry) return undefined;
    this.touch(entry);
    return entry.mesh;
  }

  /**
   * The best stand-in while the wanted mesh is being built (the old one keeps drawing
   * meanwhile): the object's cached mesh of the nearest bucket (the finer one on a
   * tie), of the current version or, while an edit is meshed, of the older one still cached.
   * Marked as drawn this frame.
   *
   * @param objectId - The path object.
   * @param bucket - The wanted zoom bucket.
   * @returns The stand-in, or `undefined` when the object has no mesh.
   */
  nearest(objectId: string, bucket: number): TMesh | undefined {
    const entries = this.entriesByObject.get(objectId) ?? [];
    let best: CacheEntry<TMesh> | undefined;
    for (const entry of entries) {
      if (!best || isBetterStandIn(entry, best, bucket)) best = entry;
    }
    if (!best) return undefined;
    this.touch(best);
    return best.mesh;
  }

  /**
   * Whether a mesh of an older version of an object is cached, in any bucket: the object's
   * geometry changed since it was last meshed. Marks nothing as drawn.
   *
   * @param objectId - The path object.
   * @param version - Its current version.
   * @returns True when one is.
   */
  hasOlderVersion(objectId: string, version: number): boolean {
    return (this.entriesByObject.get(objectId) ?? []).some((entry) => entry.version < version);
  }

  /**
   * Caches a mesh, marked as drawn this frame, then evicts down to the budget. It replaces a
   * mesh of the same key and drops the object's older versions; a mesh of a version older than
   * one already cached is dropped at once (a job that finished after the object changed).
   *
   * @param objectId - The path object.
   * @param version - Its network's version.
   * @param bucket - The zoom bucket.
   * @param mesh - The mesh.
   */
  set(objectId: string, version: number, bucket: number, mesh: TMesh): void {
    const entries = this.entriesByObject.get(objectId) ?? [];
    if (entries.some((entry) => entry.version > version)) {
      this.onDrop?.(mesh);
      return;
    }
    const kept: CacheEntry<TMesh>[] = [];
    for (const entry of entries) {
      if (entry.version < version || entry.bucket === bucket) this.release(entry);
      else kept.push(entry);
    }
    this.evictionMemory.made(cacheKey(objectId, version, bucket), this.timeMs);
    const entry: CacheEntry<TMesh> = { objectId, version, bucket, mesh, usedFrame: this.frame };
    kept.push(entry);
    this.entriesByObject.set(objectId, kept);
    this.recency.add(entry);
    this.activeCount += 1;
    this.bytes += mesh.byteLength;
    this.trim();
  }

  /** Evicts meshes not drawn this frame, least recently drawn first, until within the budget. */
  trim(): void {
    if (this.activeCount === this.recency.size) return;
    for (const entry of this.recency) {
      if (this.bytes <= this.budget) return;
      if (entry.usedFrame === this.frame) continue;
      this.remove(entry);
      this.evictionMemory.evicted(
        cacheKey(entry.objectId, entry.version, entry.bucket),
        this.timeMs,
      );
      this.evictionCount += 1;
    }
  }

  /**
   * Releases an object's active pins after it leaves a retained viewport, preserving other pins.
   *
   * @param objectId - The object that is no longer drawn.
   */
  unpin(objectId: string): void {
    for (const entry of this.entriesByObject.get(objectId) ?? []) {
      if (entry.usedFrame !== this.frame) continue;
      entry.usedFrame = this.frame - 1;
      this.activeCount -= 1;
      // Departures are newer than previously inactive entries. Active entries are skipped.
      this.recency.delete(entry);
      this.recency.add(entry);
    }
  }

  /**
   * Drops every mesh of an object (it was deleted, or is no longer a path).
   *
   * @param objectId - The object.
   */
  deleteObject(objectId: string): void {
    for (const entry of this.entriesByObject.get(objectId) ?? []) this.release(entry);
    this.entriesByObject.delete(objectId);
  }

  /** Drops every mesh. */
  clear(): void {
    for (const entry of this.recency) this.release(entry);
    this.entriesByObject.clear();
  }

  private touch(entry: CacheEntry<TMesh>): void {
    if (entry.usedFrame !== this.frame) this.activeCount += 1;
    entry.usedFrame = this.frame;
    this.recency.delete(entry);
    this.recency.add(entry);
  }

  /**
   * Removes an entry from the recency list and the byte count, and lets its mesh go.
   *
   * @param entry - The entry.
   */
  private release(entry: CacheEntry<TMesh>): void {
    if (entry.usedFrame === this.frame) this.activeCount -= 1;
    this.recency.delete(entry);
    this.bytes -= entry.mesh.byteLength;
    this.onDrop?.(entry.mesh);
  }

  /**
   * Releases an entry and removes it from its object's list.
   *
   * @param entry - The entry.
   */
  private remove(entry: CacheEntry<TMesh>): void {
    this.release(entry);
    const remaining = (this.entriesByObject.get(entry.objectId) ?? []).filter(
      (candidate) => candidate !== entry,
    );
    if (remaining.length > 0) this.entriesByObject.set(entry.objectId, remaining);
    else this.entriesByObject.delete(entry.objectId);
  }
}

/**
 * Whether one cached entry is a better stand-in than another for a wanted bucket: the nearer
 * bucket, and the finer one on a tie. An object's entries all share one version (a newer one
 * drops the older), so the version needs no comparing.
 *
 * @param entry - The candidate.
 * @param best - The best so far.
 * @param bucket - The wanted bucket.
 * @returns True when `entry` is better.
 */
function isBetterStandIn<TMesh>(
  entry: CacheEntry<TMesh>,
  best: CacheEntry<TMesh>,
  bucket: number,
): boolean {
  const entryDistance = Math.abs(entry.bucket - bucket);
  const bestDistance = Math.abs(best.bucket - bucket);
  return (
    entryDistance < bestDistance || (entryDistance === bestDistance && entry.bucket > best.bucket)
  );
}

/**
 * A cached mesh's key for the eviction memory.
 *
 * @param objectId - The path.
 * @param version - Its mesh input's version.
 * @param bucket - The zoom bucket.
 * @returns The key.
 */
function cacheKey(objectId: string, version: number, bucket: number): string {
  return `${objectId}|${String(version)}|${String(bucket)}`;
}
