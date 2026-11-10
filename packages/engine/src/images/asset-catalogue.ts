import { IMAGE_LEVEL_LONG_EDGES_PX, type AssetId } from '@canvas/schema';

import type { DecodedLevel } from '../workers/job-kinds.js';

export type { CatalogueEntry } from './catalogue-entry.js';

import type { AssetSource, ImageAssetInfo } from './asset-source.js';
import { isDescribedGif, type CatalogueEntry } from './catalogue-entry.js';
import { assetView } from './image-needs.js';
import type { LevelSource } from './level-loader.js';
import type { Size } from './level-selection.js';
import { RetrySchedule } from './retry-schedule.js';
import { SmallestCopies } from './smallest-copies.js';

/**
 * The longest original an untiled image shows as its top level, px: the largest pyramid level.
 * A larger original is only ever decoded to make the smaller levels.
 */
export const ORIGINAL_LEVEL_MAX_LONG_EDGE_PX = 4096;

/**
 * The long edges an image can show, smallest first:
 * - An untiled image: the pyramid's levels shorter than the original, which the client can make
 *   by resizing the original in a job worker while the server's are missing; and the original
 *   itself as the top level when its long edge is at most the GPU's texture limit and
 *   {@link ORIGINAL_LEVEL_MAX_LONG_EDGE_PX}, so an image zoomed past its largest server level
 *   shows full resolution. The original is an ordinary level under the budget: evicted when
 *   idle, refused when it does not fit (the largest level below it stays shown).
 * - A tiled image: only the levels the server made (tiles show it above them); its original is
 *   never decoded on the client, so until the server lists a level it has none and shows its
 *   placeholder.
 *
 * Pure.
 *
 * @param naturalSize - The original's size, px.
 * @param info - The asset's description: whether it is tiled, and its server levels.
 * @param maxTextureSize - The GPU's largest texture edge, px.
 * @returns The long edges, smallest first; empty for a tiled image with no server level yet.
 */
export function showableLevels(
  naturalSize: Size,
  info: ImageAssetInfo,
  maxTextureSize: number,
): number[] {
  const longEdge = Math.max(naturalSize.width, naturalSize.height);
  if (info.tiles !== null) {
    const made = new Set(info.levels.map(({ longEdgePx }) => longEdgePx));
    return [...made].filter((edge) => edge <= maxTextureSize).sort((a, b) => a - b);
  }
  const levels: number[] = IMAGE_LEVEL_LONG_EDGES_PX.filter(
    (edge) => edge < longEdge && edge <= maxTextureSize,
  );
  if (longEdge <= Math.min(maxTextureSize, ORIGINAL_LEVEL_MAX_LONG_EDGE_PX)) levels.push(longEdge);
  return levels;
}

/**
 * Whether the server has made a level, so it is fetched rather than resized from the original.
 *
 * @param info - The asset's description.
 * @param longEdgePx - The level.
 * @returns True for a server level.
 */
export function isServerLevel(info: ImageAssetInfo, longEdgePx: number): boolean {
  return info.levels.some((level) => level.longEdgePx === longEdgePx);
}

/**
 * The CPU copies of smallest levels a catalogue keeps by default: 64 MiB, the 128 px levels of
 * about 1300 photos.
 */
export const DEFAULT_MAX_COPY_BYTES = 64 * 1024 * 1024;

/**
 * Called when an asset's description arrives, changes or fails.
 *
 * @param assetId - The asset.
 */
export type CatalogueListener = (assetId: AssetId) => void;

/**
 * The texture manager's catalogue of assets: each asset is described once through the
 * `AssetSource` and followed for new levels (the server finishing its pyramid, or a pending
 * description becoming known), and keeps the CPU copy of its smallest level. It outlives
 * the GPU: after a device loss the engine's new texture manager reads the same catalogue, so
 * every image restarts at once from its smallest level. Image objects `use` and `release` their
 * assets; unused assets stop being followed at `sweep`, but their bounded CPU copies can
 * restore them on undo. Reused assets are described again. On the thread that renders.
 */
export class AssetCatalogue {
  private readonly entries = new Map<AssetId, CatalogueEntry>();
  private readonly listeners = new Set<CatalogueListener>();
  private readonly copies: SmallestCopies;
  private readonly restored = new WeakSet<CatalogueEntry>();
  /** How many image objects use each asset (`use`, `release`). */
  private readonly references = new Map<AssetId, number>();
  /** Whether an asset lost its last reference since the last `sweep`. */
  private hasUnreferenced = false;
  /** The entries that are described GIFs (`isDescribedGif`), kept as their status changes. */
  private readonly gifs = new Set<AssetId>();
  private gifChanges = 0;

  /**
   * Creates an empty catalogue.
   *
   * @param assets - The source.
   * @param maxTextureSize - The GPU's largest texture edge, px.
   * @param maxCopyBytes - The CPU copies of smallest levels kept at most, bytes; the least
   *   recently used go first (their images show their colour until the level is loaded again).
   * @param retries - When a description that failed is asked for again (a few times, with
   *   backoff: right after an upload the asset may not be linked to the board yet).
   */
  constructor(
    readonly assets: AssetSource,
    private maxTextureSize: number,
    maxCopyBytes = DEFAULT_MAX_COPY_BYTES,
    private readonly retries = new RetrySchedule<AssetId>(),
  ) {
    this.copies = new SmallestCopies(maxCopyBytes, (id) => this.references.has(id));
  }

  /**
   * A revision that changes whenever an asset becomes, or stops being, a described GIF: playback
   * finds its GIF candidates again only then, or when the candidates change.
   *
   * @returns The revision.
   */
  get gifRevision(): number {
    return this.gifChanges;
  }

  /**
   * Whether an asset's entry is a described GIF, one that may play (`isDescribedGif`).
   *
   * @param assetId - The asset.
   * @returns True when it is.
   */
  isDescribedGif(assetId: AssetId): boolean {
    return this.gifs.has(assetId);
  }

  /**
   * Listens for descriptions arriving, changing or failing.
   *
   * @param listener - Called with the asset.
   * @returns Stops listening.
   */
  listen(listener: CatalogueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * An asset's entry, restoring any cached thumbnail and describing it on first use or reuse.
   *
   * @param assetId - The asset.
   * @returns Its entry.
   */
  entry(assetId: AssetId): CatalogueEntry {
    let entry = this.entries.get(assetId);
    if (entry === undefined) {
      entry = {
        assetId,
        status: 'describing',
        info: undefined,
        levels: [],
        view: undefined,
        smallest: undefined,
        hasBeenReady: false,
        ...this.copies.get(assetId),
        unsubscribe: undefined,
      };
      this.entries.set(assetId, entry);
      this.noteGif(entry);
      if (entry.smallest !== undefined) {
        this.copies.touch(entry);
        this.restored.add(entry);
      }
      this.describe(entry);
    }
    return entry;
  }

  /**
   * Notes one more image object using an asset: its entry, started the first time; a `failed`
   * one is described again, since an object that starts using an asset may come with a board
   * that can now read it.
   *
   * @param assetId - The asset.
   * @returns Its entry.
   */
  use(assetId: AssetId): CatalogueEntry {
    this.references.set(assetId, (this.references.get(assetId) ?? 0) + 1);
    const entry = this.entry(assetId);
    this.describeAgainIfFailed(assetId);
    return entry;
  }

  /**
   * Notes one image object fewer using an asset. At the next `sweep` it stops being followed,
   * while its CPU copy stays within the copy cap for undo or a lost device.
   *
   * @param assetId - The asset.
   */
  release(assetId: AssetId): void {
    const count = (this.references.get(assetId) ?? 0) - 1;
    if (count > 0) {
      this.references.set(assetId, count);
      return;
    }
    this.references.delete(assetId);
    this.hasUnreferenced = true;
  }

  /**
   * Stops following unused entries; their CPU copies and metadata remain under the copy cap.
   * Cheap when nothing lost its last reference.
   */
  sweep(): void {
    if (!this.hasUnreferenced) return;
    this.hasUnreferenced = false;
    for (const [assetId, entry] of this.entries) {
      if (this.references.has(assetId)) continue;
      entry.unsubscribe?.();
      entry.unsubscribe = undefined;
      this.entries.delete(assetId);
      if (this.gifs.delete(assetId)) this.gifChanges += 1;
      this.retries.succeed(assetId);
    }
  }

  /**
   * Describes a `failed` asset again, its retries forgotten: an object using it was seen again
   * (the board may be linked to it now). Nothing for an asset in any other state.
   *
   * @param assetId - The asset.
   */
  describeAgainIfFailed(assetId: AssetId): void {
    const entry = this.entries.get(assetId);
    if (entry?.status !== 'failed') return;
    entry.status = 'describing';
    this.noteGif(entry);
    this.retries.succeed(assetId);
    this.describe(entry);
  }

  /**
   * Tells the source an object using an asset changed while its description is pending
   * (`AssetSource.revive`), so an adapter that gave up following it follows it again. Nothing
   * for an asset in any other state.
   *
   * @param assetId - The asset.
   */
  revive(assetId: AssetId): void {
    if (this.entries.get(assetId)?.status === 'describing') this.assets.revive?.(assetId);
  }

  /**
   * Follows a new GPU's texture limit (after a lost device, the new backend's): every described
   * asset's levels and view are worked out again, and its images rebound.
   *
   * @param maxTextureSize - The GPU's largest texture edge, px.
   */
  setMaxTextureSize(maxTextureSize: number): void {
    if (maxTextureSize === this.maxTextureSize) return;
    this.maxTextureSize = maxTextureSize;
    for (const entry of new Set([...this.entries.values(), ...this.copies.values()])) {
      if (entry.info === undefined) continue;
      const smallest = entry.levels[0];
      this.accept(entry, entry.info);
      if (entry.levels[0] !== smallest) this.copies.drop(entry);
    }
  }

  /**
   * An asset's entry, without starting anything.
   *
   * @param assetId - The asset.
   * @returns Its entry, or undefined when never asked for.
   */
  peek(assetId: AssetId): CatalogueEntry | undefined {
    return this.entries.get(assetId);
  }

  /**
   * Keeps a CPU copy of an asset's smallest level, when `source` is that level.
   *
   * @param source - Where the pixels came from.
   * @param level - The pixels.
   * @returns Whether this decoded the current smallest level (the asset is now ready).
   */
  keepSmallest(source: LevelSource, level: DecodedLevel): boolean {
    const entry = source.kind === 'tile' ? undefined : this.entries.get(source.assetId);
    if (entry?.levels[0] !== source.longEdgePx) return false;
    this.copies.keep(entry, level);
    return true;
  }

  /**
   * The CPU copy of an asset's smallest level, when `source` is that level and it was kept.
   *
   * @param source - A level.
   * @returns The pixels, or undefined.
   */
  smallestOf(source: LevelSource): DecodedLevel | undefined {
    const entry = source.kind === 'tile' ? undefined : this.entries.get(source.assetId);
    if (entry?.levels[0] !== source.longEdgePx || entry.smallest === undefined) return undefined;
    this.copies.touch(entry);
    return entry.smallest;
  }

  /**
   * Stops following every asset, frees every CPU copy, stops every description's retry wait and
   * forgets every listener: the engine is destroyed.
   */
  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.unsubscribe?.();
      this.copies.drop(entry);
    }
    this.copies.clear();
    this.retries.stopAll();
    this.entries.clear();
    if (this.gifs.size > 0) this.gifChanges += 1;
    this.gifs.clear();
    this.references.clear();
    this.listeners.clear();
  }

  private describe(entry: CatalogueEntry): void {
    this.assets.describe(entry.assetId).then(
      (info) => {
        if (this.entries.get(entry.assetId) !== entry) return;
        this.retries.succeed(entry.assetId);
        this.restored.delete(entry);
        this.accept(entry, info);
        entry.unsubscribe ??= this.assets.subscribe(entry.assetId, (next) => {
          if (this.entries.get(entry.assetId) === entry) this.accept(entry, next);
        });
      },
      () => {
        if (this.entries.get(entry.assetId) !== entry) return;
        if (this.restored.delete(entry)) {
          this.copies.drop(entry);
          entry.hasBeenReady = false;
          entry.status = 'describing';
          entry.info = undefined;
          entry.levels = [];
          entry.view = undefined;
          this.noteGif(entry);
          this.notify(entry.assetId);
        }
        // An unknown asset, or one not linked to this board yet: its images keep a neutral
        // placeholder while the description is retried, and for good once the retries run out.
        const willRetry = this.retries.fail(entry.assetId, () => {
          if (this.entries.get(entry.assetId) === entry) this.describe(entry);
        });
        if (willRetry) return;
        entry.status = 'failed';
        this.noteGif(entry);
        this.notify(entry.assetId);
      },
    );
  }

  private accept(entry: CatalogueEntry, info: ImageAssetInfo): void {
    entry.info = info;
    // Until the service has read the image its size is unknown: a placeholder, no levels, and
    // no decoding of the original to find out.
    const { naturalSize } = info;
    const levels =
      naturalSize === null ? [] : showableLevels(naturalSize, info, this.maxTextureSize);
    const isShowable = naturalSize !== null && levels.length > 0;
    entry.status = isShowable ? 'described' : 'describing';
    entry.levels = levels;
    entry.view = isShowable ? assetView(entry.assetId, info, naturalSize, levels) : undefined;
    // A copy kept after its entry was swept is accepted again on a new texture limit: not listed.
    if (this.entries.get(entry.assetId) === entry) this.noteGif(entry);
    this.notify(entry.assetId);
  }

  private noteGif(entry: CatalogueEntry): void {
    const isGif = isDescribedGif(entry);
    if (isGif === this.gifs.has(entry.assetId)) return;
    if (isGif) this.gifs.add(entry.assetId);
    else this.gifs.delete(entry.assetId);
    this.gifChanges += 1;
  }

  private notify(assetId: AssetId): void {
    for (const listener of [...this.listeners]) listener(assetId);
  }
}
