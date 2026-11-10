import type { GpuTextureFormat } from '../../gpu/gpu-texture.js';
import { EvictionMemory } from '../../memory/eviction-memory.js';

import { cellTexels, pageFormatOf, type AtlasUpload } from './atlas-upload.js';
import type { AtlasGlyph, AtlasMemoryReport, AtlasPage } from './glyph-atlas-types.js';
import type { GlyphBitmap, GlyphField } from './glyph-bitmap.js';
import { GLYPH_ATLAS_GUTTER, maxTierForPage } from './glyph-cell.js';
import type { GlyphKey } from './glyph-key.js';
import { placedGlyph } from './glyph-placement.js';
import type { GlyphTier } from './glyph-tiers.js';
import { ShelfAllocator, type ShelfAllocation } from './shelf-allocator.js';

export { GLYPH_ATLAS_GUTTER } from './glyph-cell.js';

/** The default page side, in texels. */
export const DEFAULT_ATLAS_PAGE_SIZE = 2048;

/** The default budget: three 2048² RGBA pages (the prototype capped the atlas at six). */
export const DEFAULT_ATLAS_BUDGET_BYTES = 3 * DEFAULT_ATLAS_PAGE_SIZE * DEFAULT_ATLAS_PAGE_SIZE * 4;

export type { AtlasGlyph, AtlasMemoryReport, AtlasPage } from './glyph-atlas-types.js';

/** How to size a {@link GlyphAtlas}. */
export interface GlyphAtlasOptions {
  /** Page side, in texels, at most the backend's `maxTextureSize`. Default 2048. */
  readonly pageSize?: number;
  /**
   * The side of a single-channel (R8) page, in texels, at least `pageSize` and at most the
   * backend's `maxTextureSize`. Default `pageSize`. Twice `pageSize` gives an R8 page
   * an RGBA page's bytes, so text whose glyphs are all single-channel (CJK faces msdfgen cannot
   * read) fits a quarter of the pages: the text shader's page switch then covers fewer pages.
   */
  readonly singleChannelPageSize?: number;
  /** The byte budget for all pages. Default {@link DEFAULT_ATLAS_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
}

interface PageState extends AtlasPage {
  readonly allocator: ShelfAllocator;
  glyphCount: number;
}

interface Entry {
  readonly key: string;
  readonly glyph: AtlasGlyph;
  readonly page: PageState;
  readonly allocation: ShelfAllocation;
  lastUsedFrame: number;
}

function glyphKey(faceId: string, key: GlyphKey, tier: GlyphTier): string {
  // Numbers first and the face id last, so no face id can collide with another key. A codepoint
  // key reads as before; a shaped glyph's key is negative, so the two never collide.
  return `${String(tier)}|${String(key)}|${faceId}`;
}

function pageBytes(format: GpuTextureFormat, size: number): number {
  return size * size * (format === 'rgba8unorm' ? 4 : 1);
}

/**
 * The glyph atlas (the prototype's `Atlas`, `src/atlas/atlas.ts`, with eviction): glyph
 * distance fields per face, codepoint and tier, packed into square pages, RGBA8 for MSDF and R8
 * for the single-channel fallback. Pages are created on demand within a byte budget; when a
 * glyph does not fit, the least recently used glyphs not used in the current frame are evicted
 * one at a time, and a page they leave empty
 * is released. The tier cascade means an evicted glyph still draws from a lower tier while it is
 * regenerated.
 *
 * The atlas holds no GPU objects: it queues each new glyph's cell as an {@link AtlasUpload} that
 * the renderer copies into the page texture before its next pass. Every insert and eviction
 * bumps {@link GlyphAtlas.revision}; whoever caches glyph quads rebuilds them when it changes.
 */
export class GlyphAtlas {
  /** The side of its square pages, px (smaller where the budget is small). */
  readonly pageSize: number;
  /** The side of its single-channel pages, px: `pageSize` or more. */
  readonly singleChannelPageSize: number;
  /** The highest tier whose glyphs fit its pages (`maxTierForPage`); lookups ask no higher. */
  readonly maxTier: GlyphTier;
  /** Called with each glyph evicted to make room (text drawn from it is rewritten). */
  onEvict: ((glyph: AtlasGlyph) => void) | undefined = undefined;
  private budgetBytes: number;
  private readonly pageStates: PageState[] = [];
  /** Glyphs with texels, least recently used first (a Map keeps insertion order). */
  private readonly entries = new Map<string, Entry>();
  /** Glyphs without texels (spaces): free to keep, never evicted. */
  private readonly blanks = new Map<string, AtlasGlyph>();
  private uploads: AtlasUpload[] = [];
  private frame = 0;
  private nextPageId = 0;
  private revisionCount = 0;
  private evictedGlyphCount = 0;
  private rejectedGlyphCount = 0;
  /** What was evicted lately, to count glyphs generated again soon after. */
  private readonly evictions = new EvictionMemory();
  /** The current frame's time, ms, from `beginFrame`. */
  private timeMs = 0;

  /**
   * Creates an empty atlas.
   *
   * @param options - Page size and byte budget.
   */
  constructor(options: GlyphAtlasOptions = {}) {
    this.pageSize = options.pageSize ?? DEFAULT_ATLAS_PAGE_SIZE;
    this.singleChannelPageSize = Math.max(
      this.pageSize,
      options.singleChannelPageSize ?? this.pageSize,
    );
    this.maxTier = maxTierForPage(this.pageSize);
    this.budgetBytes = options.budgetBytes ?? DEFAULT_ATLAS_BUDGET_BYTES;
  }

  /**
   * Changes whenever a glyph is inserted or evicted.
   *
   * @returns A counter that only grows.
   */
  get revision(): number {
    return this.revisionCount;
  }

  /**
   * The pages the atlas holds now.
   *
   * @returns Id, format and size of each page.
   */
  get pages(): readonly AtlasPage[] {
    return this.pageStates.map(({ id, field, format, size }) => ({ id, field, format, size }));
  }

  /**
   * Starts a frame: glyphs looked up or inserted from now on are safe from eviction until the
   * next call.
   *
   * @param timeMs - The frame's time, ms, for counting regenerations; default the last frame's.
   */
  beginFrame(timeMs: number = this.timeMs): void {
    this.frame += 1;
    this.timeMs = timeMs;
    this.evictions.prune(timeMs);
  }

  /**
   * Glyphs inserted again within `REGENERATION_WINDOW_MS` of their eviction, since the atlas was
   * created ('s no-thrash counter).
   *
   * @returns The count.
   */
  get regeneratedGlyphCount(): number {
    return this.evictions.regenerations;
  }

  /**
   * Finds a glyph and marks it used in the current frame.
   *
   * @param faceId - The face.
   * @param id - The glyph: its codepoint, or a shaped glyph's id ({@link GlyphKey}).
   * @param tier - The tier.
   * @returns The glyph, or `undefined` when it is not in the atlas.
   */
  lookup(faceId: string, id: GlyphKey, tier: GlyphTier): AtlasGlyph | undefined {
    const key = glyphKey(faceId, id, tier);
    const entry = this.entries.get(key);
    if (entry === undefined) return this.blanks.get(key);
    entry.lastUsedFrame = this.frame;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.glyph;
  }

  /**
   * Adds a glyph, replacing any glyph under the same key, and queues its upload.
   *
   * @param faceId - The face.
   * @param id - The glyph: its codepoint, or a shaped glyph's id ({@link GlyphKey}).
   * @param tier - The tier it was generated at.
   * @param bitmap - Its distance field and metrics.
   * @returns Its placement, or `undefined` when it is larger than a page or no evictable glyph
   *   makes room for it.
   */
  insert(
    faceId: string,
    id: GlyphKey,
    tier: GlyphTier,
    bitmap: GlyphBitmap,
  ): AtlasGlyph | undefined {
    const key = glyphKey(faceId, id, tier);
    this.remove(key);
    this.revisionCount += 1;
    if (bitmap.width === 0 || bitmap.height === 0) {
      const blank = placedGlyph(bitmap, tier, undefined, undefined, this.pageSize);
      this.blanks.set(key, blank);
      return blank;
    }
    const format = pageFormatOf(bitmap.field);
    const cellWidth = bitmap.width + 2 * GLYPH_ATLAS_GUTTER;
    const cellHeight = bitmap.height + 2 * GLYPH_ATLAS_GUTTER;
    const placement = this.allocate(bitmap.field, cellWidth, cellHeight);
    if (placement === undefined) {
      this.rejectedGlyphCount += 1;
      return undefined;
    }
    const { page, allocation } = placement;
    this.evictions.made(key, this.timeMs);
    const glyph = placedGlyph(bitmap, tier, page.id, allocation, page.size);
    page.glyphCount += 1;
    this.entries.set(key, { key, glyph, page, allocation, lastUsedFrame: this.frame });
    this.uploads.push({
      pageId: page.id,
      region: { x: allocation.x, y: allocation.y, width: cellWidth, height: cellHeight },
      texels: cellTexels(bitmap, format, GLYPH_ATLAS_GUTTER),
    });
    return glyph;
  }

  /**
   * Hands over the uploads queued since the last call, in order.
   *
   * @returns The uploads; the atlas forgets them.
   */
  takeUploads(): AtlasUpload[] {
    const uploads = this.uploads;
    this.uploads = [];
    return uploads;
  }

  /**
   * Reports the atlas's memory for the "glyph-atlas" category.
   *
   * @returns Resident bytes, budget, counts and eviction totals.
   */
  memory(): AtlasMemoryReport {
    return {
      category: 'glyph-atlas',
      residentBytes: this.residentBytes(),
      budgetBytes: this.budgetBytes,
      pageCount: this.pageStates.length,
      glyphCount: this.entries.size,
      evictedGlyphCount: this.evictedGlyphCount,
      regeneratedGlyphCount: this.evictions.regenerations,
      rejectedGlyphCount: this.rejectedGlyphCount,
    };
  }

  /** Forgets every glyph and page, for example after the GPU device was lost. */
  clear(): void {
    this.entries.clear();
    this.blanks.clear();
    this.pageStates.length = 0;
    this.uploads = [];
    this.revisionCount += 1;
  }

  /**
   * Changes the byte budget (the scene text atlas borrows texture memory nobody uses).
   * Under a lower budget whole pages go, the least recently used first (a page is as recent as
   * its newest glyph), never one holding a glyph used this frame, until the pages fit or none can
   * go; each glyph released goes through `onEvict`. A higher budget lets later inserts open pages.
   * An urgent change (images taking their memory back within a frame) may release pages used in
   * this frame too: their textures last until the text pass mirrors the atlas again.
   *
   * @param bytes - The new budget.
   * @param isUrgent - Whether pages used in this frame may go too.
   */
  setBudget(bytes: number, isUrgent = false): void {
    this.budgetBytes = bytes;
    while (this.residentBytes() > bytes) {
      const page = this.leastRecentPage(isUrgent);
      if (page === undefined) return;
      for (const entry of [...this.entries.values()]) {
        if (entry.page === page) this.evict(entry);
      }
    }
  }

  /**
   * The page whose newest glyph is the oldest, among those holding no glyph used this frame
   * unless urgent.
   *
   * @param isUrgent - Whether pages used this frame count.
   * @returns The page, or none.
   */
  private leastRecentPage(isUrgent: boolean): PageState | undefined {
    const newest = new Map<PageState, number>();
    for (const { page, lastUsedFrame } of this.entries.values()) {
      newest.set(page, Math.max(newest.get(page) ?? -Infinity, lastUsedFrame));
    }
    let oldest: PageState | undefined;
    let oldestFrame = isUrgent ? Infinity : this.frame;
    for (const [page, frame] of newest) {
      if (frame < oldestFrame) [oldest, oldestFrame] = [page, frame];
    }
    return oldest;
  }

  private residentBytes(): number {
    return this.pageStates.reduce((total, page) => total + pageBytes(page.format, page.size), 0);
  }

  private allocate(
    field: GlyphField,
    width: number,
    height: number,
  ): { page: PageState; allocation: ShelfAllocation } | undefined {
    const side = this.sideOf(field);
    if (width > side || height > side) return undefined;
    for (;;) {
      for (const page of this.pageStates) {
        const allocation =
          page.field === field ? page.allocator.allocate(width, height) : undefined;
        if (allocation !== undefined) return { page, allocation };
      }
      if (this.residentBytes() + pageBytes(pageFormatOf(field), side) <= this.budgetBytes) {
        const page = this.addPage(field);
        const allocation = page.allocator.allocate(width, height);
        return allocation === undefined ? undefined : { page, allocation };
      }
      if (!this.evictLeastRecentlyUsed()) return undefined;
    }
  }

  /**
   * The side of a page of a field's glyphs.
   *
   * @param field - The field.
   * @returns The side, px.
   */
  private sideOf(field: GlyphField): number {
    return pageFormatOf(field) === 'r8unorm' ? this.singleChannelPageSize : this.pageSize;
  }

  private addPage(field: GlyphField): PageState {
    const page: PageState = {
      id: this.nextPageId,
      field,
      format: pageFormatOf(field),
      size: this.sideOf(field),
      allocator: new ShelfAllocator(this.sideOf(field), this.sideOf(field)),
      glyphCount: 0,
    };
    this.nextPageId += 1;
    this.pageStates.push(page);
    return page;
  }

  /**
   * Evicts the least recently used glyph not used in the current frame.
   *
   * @returns Whether a glyph was evicted.
   */
  private evictLeastRecentlyUsed(): boolean {
    const [oldest] = this.entries.values();
    if (oldest === undefined || oldest.lastUsedFrame === this.frame) return false;
    this.evict(oldest);
    return true;
  }

  /**
   * Evicts one glyph: frees its cell, tells `onEvict`, counts it.
   *
   * @param entry - The glyph.
   */
  private evict(entry: Entry): void {
    this.remove(entry.key);
    this.onEvict?.(entry.glyph);
    this.evictions.evicted(entry.key, this.timeMs);
    this.evictedGlyphCount += 1;
    this.revisionCount += 1;
  }

  private remove(key: string): void {
    this.blanks.delete(key);
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    entry.page.allocator.free(entry.allocation);
    entry.page.glyphCount -= 1;
    if (entry.page.glyphCount === 0) {
      this.pageStates.splice(this.pageStates.indexOf(entry.page), 1);
      this.uploads = this.uploads.filter((upload) => upload.pageId !== entry.page.id);
    }
  }
}
