import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';
import type { DecodedLevel } from '../workers/job-kinds.js';

import { evictionOrder, planEvictions, type EvictionCandidate } from './eviction-order.js';
import { idleBytesOf } from './idle-bytes.js';
import { ImageAtlas, type AtlasEntry } from './image-atlas.js';
import type { PageRegion } from './image-binding.js';
import {
  asArrayBufferView,
  atlasLevelOf,
  IMAGE_ATLAS_OWNER,
  IMAGE_LEVELS_OWNER,
  textureLevelOf,
  type ResidentLevel,
  type UploadRefusal,
} from './resident-level.js';
import { TexturePages } from './texture-pages.js';

export { IMAGE_ATLAS_OWNER, IMAGE_LEVELS_OWNER, type ResidentLevel, type UploadRefusal };

/** The largest atlas page edge, texels. */
const MAX_ATLAS_PAGE_SIZE = 2048;

/**
 * The image levels on the GPU and the byte budget they live under: large levels get textures
 * of their own, small levels and tiles go into the {@link ImageAtlas}; every byte is reported to
 * the `MemoryLedger` under `textures`. An upload that would pass the budget first evicts levels the
 * viewport does not need, larger first and least recently used (`evictionOrder`); when that cannot
 * make room it is refused, so the budget is never exceeded. On the thread that renders.
 */
export class TextureResidency {
  /** The pages every image record samples. */
  readonly pages: TexturePages;
  private readonly atlas: ImageAtlas;
  private readonly resident = new Map<string, ResidentLevel>();
  private ownBytes = 0;
  /** The level a running upload will replace: still resident, but not counted or evictable. */
  private replacing: ResidentLevel | undefined;

  /**
   * Creates an empty residency.
   *
   * @param backend - The backend.
   * @param ledger - Where bytes are reported.
   * @param budgetBytes - The `textures` budget.
   * @param onEvicted - Called with each evicted key.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly ledger: MemoryLedger,
    public budgetBytes: number,
    private readonly onEvicted: (key: string) => void,
  ) {
    this.pages = new TexturePages(backend);
    const pageSize = Math.min(MAX_ATLAS_PAGE_SIZE, backend.capabilities.maxTextureSize);
    this.atlas = new ImageAtlas(backend, this.pages, pageSize);
  }

  /**
   * The GPU bytes held: own textures plus whole atlas pages.
   *
   * @returns Bytes.
   */
  get residentBytes(): number {
    return this.ownBytes + this.atlas.bytes;
  }

  /**
   * The bytes the budget counts while an upload runs: {@link residentBytes} without the own
   * texture the upload replaces, which is freed the moment the new one is placed.
   *
   * @returns Bytes.
   */
  private get committedBytes(): number {
    const { replacing } = this;
    return this.residentBytes - (replacing?.entry === undefined ? (replacing?.bytes ?? 0) : 0);
  }

  /**
   * A resident level.
   *
   * @param key - Its key.
   * @returns It, or undefined.
   */
  get(key: string): ResidentLevel | undefined {
    return this.resident.get(key);
  }

  /**
   * Every resident level's and tile's key, for diagnostics.
   *
   * @returns The keys, in upload order.
   */
  keys(): string[] {
    return [...this.resident.keys()];
  }

  /**
   * The key of the level resident at a page region: what a binding draws, for diagnostics.
   *
   * @param region - A region a binding draws from.
   * @returns The key, or `gone` when nothing resident is there.
   */
  keyAt(region: PageRegion): string {
    for (const level of this.resident.values()) {
      const { page, u0, v0 } = level.region;
      if (page === region.page && u0 === region.u0 && v0 === region.v0) return level.key;
    }
    return 'gone';
  }

  /**
   * The bind group entries of a page.
   *
   * @param page - The page.
   * @returns Its texture and sampler.
   */
  pageEntries(page: number): readonly GpuBindGroupEntry[] {
    return this.pages.entriesOf(page);
  }

  /**
   * Uploads a decoded level, evicting what the budget requires. A new version of a resident
   * atlas level that fits the rectangle the old one holds is written into it in place (nothing
   * is evicted or refused). Any other new version replaces the old one once placed, and may
   * evict only what `makeRoom` is certain to make room with; a refused upload evicts nothing
   * and leaves the resident level, its texture and the byte accounting as they were.
   *
   * @param key - Its key.
   * @param level - Its pixels.
   * @param frameIndex - The frame, as its last use.
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns The resident level, or why it was refused.
   */
  upload(
    key: string,
    level: DecodedLevel,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): ResidentLevel | UploadRefusal {
    const { widthPx, heightPx } = level;
    const maxSize = this.backend.capabilities.maxTextureSize;
    if (widthPx > maxSize || heightPx > maxSize) return 'too-large';
    const previous = this.resident.get(key);
    const reused =
      previous?.entry === undefined
        ? undefined
        : this.atlas.reuse(previous.entry, widthPx, heightPx);
    if (reused !== undefined) return this.replaceInPlace(key, reused, level, frameIndex);
    // A new version of a resident level (the server's, replacing the client's) takes its place
    // once it is placed. Until then the old one stays resident and drawable: it only stops
    // counting against the budget (its own texture) and being a candidate for eviction.
    this.replacing = previous;
    let placed: ResidentLevel | UploadRefusal;
    try {
      placed = this.atlas.isSmall(widthPx, heightPx)
        ? this.placeInAtlas(key, level, frameIndex, isNeeded)
        : this.placeInTexture(key, level, frameIndex, isNeeded);
    } finally {
      this.replacing = undefined;
    }
    if (typeof placed === 'string') return placed;
    this.release(key);
    this.resident.set(key, placed);
    this.report();
    return placed;
  }

  /**
   * Writes a new version of an atlas level into the rectangle of the old one.
   *
   * @param key - Its key.
   * @param entry - The rectangle, taken over from the old version.
   * @param level - The new pixels.
   * @param frameIndex - The frame, as its last use.
   * @returns The new resident level.
   */
  private replaceInPlace(
    key: string,
    entry: AtlasEntry,
    level: DecodedLevel,
    frameIndex: number,
  ): ResidentLevel {
    const placed = atlasLevelOf(key, entry, level, frameIndex, this.atlas.pageSize);
    // Resident before the write, so a throwing write leaves entry and level agreeing.
    this.resident.set(key, placed);
    this.atlas.upload(entry, asArrayBufferView(level.rgba));
    return placed;
  }

  /**
   * Frees a resident level.
   *
   * @param key - Its key.
   * @returns Whether it was resident.
   */
  evict(key: string): boolean {
    if (!this.release(key)) return false;
    this.onEvicted(key);
    return true;
  }

  /**
   * Evicts idle levels, larger and older first, until the resident bytes fit a lowered budget.
   *
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns Whether they fit; when they cannot, nothing is evicted.
   */
  fitBudget(isNeeded: (key: string) => boolean): boolean {
    return this.makeRoom(0, isNeeded);
  }

  /**
   * Evicts every level not needed now: after an allocation failure, to fall back to lower levels.
   *
   * @param isNeeded - Whether a resident key is needed now.
   * @returns How many were evicted.
   */
  evictIdle(isNeeded: (key: string) => boolean): number {
    const idle = [...this.resident.keys()].filter((key) => !isNeeded(key));
    for (const key of idle) this.evict(key);
    return idle.length;
  }

  /** Destroys every texture and removes the ledger entries. */
  destroy(): void {
    this.pages.destroy();
    this.resident.clear();
    this.ownBytes = 0;
    this.ledger.delete('textures', IMAGE_LEVELS_OWNER);
    this.ledger.delete('textures', IMAGE_ATLAS_OWNER);
  }

  /**
   * Frees a resident level's GPU memory, without calling it an eviction.
   *
   * @param key - Its key.
   * @returns Whether it was resident.
   */
  private release(key: string): boolean {
    const level = this.resident.get(key);
    if (level === undefined) return false;
    this.resident.delete(key);
    if (level.entry !== undefined) {
      this.atlas.release(level.entry);
    } else {
      this.pages.remove(level.region.page);
      this.ownBytes -= level.bytes;
    }
    this.report();
    return true;
  }

  private idleBytes(candidates: readonly EvictionCandidate[]): number {
    return idleBytesOf(
      candidates,
      (key) => this.resident.get(key)?.entry?.page,
      this.atlas.pageBytes,
      this.replacing?.entry?.page,
    );
  }

  private candidates(isNeeded: (key: string) => boolean): EvictionCandidate[] {
    return [...this.resident.values()]
      .filter((level) => level !== this.replacing)
      .map(({ key, bytes, lastUsedFrame }) => ({
        key,
        bytes,
        lastUsedFrame,
        isNeeded: isNeeded(key),
      }));
  }

  /**
   * Makes room for `incomingBytes` more by evicting idle levels: own textures by the eviction
   * plan (exact, since each frees its bytes); when they cannot make room, idle atlas entries
   * too, in eviction order, until the pages they empty free enough. When even evicting every
   * idle level would not make room it evicts nothing, as `planEvictions` does, so a level that
   * cannot fit never empties the cache for nothing.
   *
   * @param incomingBytes - The bytes to add.
   * @param isNeeded - Whether a resident key is needed now.
   * @returns Whether they fit now.
   */
  private makeRoom(incomingBytes: number, isNeeded: (key: string) => boolean): boolean {
    const fits = (): boolean => this.committedBytes + incomingBytes <= this.budgetBytes;
    if (fits()) return true;
    const candidates = this.candidates(isNeeded);
    const own = candidates.filter(
      (candidate) => this.resident.get(candidate.key)?.entry === undefined,
    );
    const plan = planEvictions(own, this.committedBytes, this.budgetBytes, incomingBytes);
    if (plan.canFit) {
      for (const key of plan.evict) this.evict(key);
      return true;
    }
    if (this.committedBytes - this.idleBytes(candidates) + incomingBytes > this.budgetBytes) {
      return false;
    }
    for (const candidate of evictionOrder(candidates)) {
      if (fits()) return true;
      this.evict(candidate.key);
    }
    return fits();
  }

  private placeInTexture(
    key: string,
    level: DecodedLevel,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): ResidentLevel | UploadRefusal {
    const { widthPx, heightPx, rgba } = level;
    const bytes = widthPx * heightPx * 4;
    if (!this.makeRoom(bytes, isNeeded)) return 'over-budget';
    let texture: GpuTexture;
    try {
      texture = this.backend.createTexture({
        format: 'rgba8unorm',
        width: widthPx,
        height: heightPx,
        label: `image ${key}`,
      });
    } catch {
      return 'allocation-failed';
    }
    this.backend.writeTexture(texture, asArrayBufferView(rgba));
    this.ownBytes += bytes;
    // The replaced texture, if any, is still alive: report both, freed once this one is stored.
    this.report();
    return textureLevelOf(key, level, texture, this.pages.add(texture), frameIndex);
  }

  /**
   * Evicts idle atlas entries, least useful first, until one leaves room for a level.
   *
   * @param widthPx - The level's width, px.
   * @param heightPx - The level's height, px.
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns The entry, or undefined when no idle entry leaves room.
   */
  private reuseIdleAtlasRoom(
    widthPx: number,
    heightPx: number,
    isNeeded: (key: string) => boolean,
  ): AtlasEntry | undefined {
    const idleEntries = evictionOrder(this.candidates(isNeeded)).filter(
      (candidate) => this.resident.get(candidate.key)?.entry !== undefined,
    );
    for (const candidate of idleEntries) {
      this.evict(candidate.key);
      const entry = this.atlas.allocate(widthPx, heightPx, false);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  private placeInAtlas(
    key: string,
    level: DecodedLevel,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): ResidentLevel | UploadRefusal {
    const { widthPx, heightPx, rgba } = level;
    let entry = this.atlas.allocate(widthPx, heightPx, false);
    // A full atlas at the budget reuses the room of idle entries before it asks for a page: a
    // new page would cost evicting levels until a whole page is free. Not for a replacement:
    // the old rectangle stays pinned, so whether evicting idle entries leaves room cannot be
    // known before evicting them.
    if (
      entry === undefined &&
      this.replacing === undefined &&
      this.residentBytes + this.atlas.pageBytes > this.budgetBytes
    ) {
      entry = this.reuseIdleAtlasRoom(widthPx, heightPx, isNeeded);
    }
    if (entry === undefined && this.makeRoom(this.atlas.pageBytes, isNeeded)) {
      try {
        entry = this.atlas.allocate(widthPx, heightPx, true);
      } catch {
        return 'allocation-failed';
      }
    }
    if (entry === undefined) return 'over-budget';
    this.report();
    this.atlas.upload(entry, asArrayBufferView(rgba));
    return atlasLevelOf(key, entry, level, frameIndex, this.atlas.pageSize);
  }

  private report(): void {
    this.ledger.set('textures', IMAGE_LEVELS_OWNER, this.ownBytes);
    this.ledger.set('textures', IMAGE_ATLAS_OWNER, this.atlas.bytes);
  }
}
