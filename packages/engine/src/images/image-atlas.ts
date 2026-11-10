import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';
import { ShelfAllocator, type ShelfAllocation } from '../text/atlas/shelf-allocator.js';

import type { TexturePages } from './texture-pages.js';

/** The largest image level or tile the atlas takes, px on each side. */
export const ATLAS_MAX_ITEM_PX = 256;

/** An image's place in the atlas: a page and a rectangle of texels on it. */
export interface AtlasEntry {
  /** The page it is on (a `TexturePages` page). */
  readonly page: number;
  /** Left edge, texels. */
  readonly x: number;
  /** Top edge, texels. */
  readonly y: number;
  /** Width, texels: the image's own. */
  readonly width: number;
  /** Height, texels: the image's own. */
  readonly height: number;
}

/** One atlas page: its texture's page number and its packer. */
interface AtlasPage {
  readonly page: number;
  readonly texture: GpuTexture;
  readonly packer: ShelfAllocator;
  /** The allocations handed out, by entry, for freeing. */
  readonly allocations: Map<AtlasEntry, ShelfAllocation>;
}

/**
 * Texture atlases for small images (small images share texture atlases so they do not each cost a
 * texture bind): every image level and tile of at most {@link ATLAS_MAX_ITEM_PX} px goes onto a
 * shared RGBA page, packed by shelves (`ShelfAllocator`, which frees), so the images of one page
 * draw in one call. A page that empties is destroyed. Shaders clamp their samples half a texel
 * inside an entry, so neighbours never bleed into it and entries need no gutter. On the thread that
 * renders.
 */
export class ImageAtlas {
  private readonly pages: AtlasPage[] = [];

  /**
   * Creates an empty atlas.
   *
   * @param backend - The backend its pages live on.
   * @param texturePages - Where its pages get their page numbers.
   * @param pageSize - Each page's edge, texels (2048, or less on a small GPU).
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly texturePages: TexturePages,
    readonly pageSize: number,
  ) {}

  /**
   * The GPU bytes of one page.
   *
   * @returns Bytes.
   */
  get pageBytes(): number {
    return this.pageSize * this.pageSize * 4;
  }

  /**
   * The atlas's GPU bytes: whole pages, used or not.
   *
   * @returns Bytes.
   */
  get bytes(): number {
    return this.pages.length * this.pageBytes;
  }

  /**
   * The number of pages.
   *
   * @returns The count.
   */
  get pageCount(): number {
    return this.pages.length;
  }

  /**
   * Whether an item goes into the atlas rather than a texture of its own.
   *
   * @param width - Its width, px.
   * @param height - Its height, px.
   * @returns True when both sides are at most {@link ATLAS_MAX_ITEM_PX}.
   */
  isSmall(width: number, height: number): boolean {
    return width <= ATLAS_MAX_ITEM_PX && height <= ATLAS_MAX_ITEM_PX;
  }

  /**
   * Finds room for an item on an existing page, else opens a page when allowed.
   *
   * @param width - Its width, px.
   * @param height - Its height, px.
   * @param canOpenPage - Whether a new page fits the budget.
   * @returns The entry, or undefined when there is no room.
   */
  allocate(width: number, height: number, canOpenPage: boolean): AtlasEntry | undefined {
    for (const page of this.pages) {
      const entry = this.place(page, width, height);
      if (entry !== undefined) return entry;
    }
    if (!canOpenPage) return undefined;
    const texture = this.backend.createTexture({
      format: 'rgba8unorm',
      width: this.pageSize,
      height: this.pageSize,
      label: `image atlas ${String(this.pages.length)}`,
    });
    const page: AtlasPage = {
      page: this.texturePages.add(texture),
      texture,
      packer: new ShelfAllocator(this.pageSize, this.pageSize),
      allocations: new Map(),
    };
    this.pages.push(page);
    return this.place(page, width, height);
  }

  /**
   * Writes an item's pixels into its entry.
   *
   * @param entry - The entry.
   * @param rgba - Its pixels, `width × height × 4` bytes, rows top to bottom.
   */
  upload(entry: AtlasEntry, rgba: Uint8Array<ArrayBuffer>): void {
    const page = this.pageOf(entry);
    this.backend.writeTexture(page.texture, rgba, {
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
    });
  }

  /**
   * Frees an entry; a page left empty is destroyed.
   *
   * @param entry - The entry.
   */
  release(entry: AtlasEntry): void {
    const page = this.pageOf(entry);
    const allocation = page.allocations.get(entry);
    if (allocation === undefined) return;
    page.allocations.delete(entry);
    page.packer.free(allocation);
    if (page.allocations.size === 0) {
      this.pages.splice(this.pages.indexOf(page), 1);
      this.texturePages.remove(page.page);
    }
  }

  /**
   * Takes over the rectangle an entry holds for an item that fits in it: the item is drawn from
   * the rectangle's top-left corner and freeing the new entry frees the whole rectangle. The old
   * entry is no longer live.
   *
   * @param entry - The live entry to reuse.
   * @param width - The new item's width, px.
   * @param height - The new item's height, px.
   * @returns The new entry, or undefined when the item does not fit the rectangle.
   */
  reuse(entry: AtlasEntry, width: number, height: number): AtlasEntry | undefined {
    const page = this.pageOf(entry);
    const allocation = page.allocations.get(entry);
    if (allocation === undefined || width > allocation.width || height > allocation.height) {
      return undefined;
    }
    const reused: AtlasEntry = { page: entry.page, x: entry.x, y: entry.y, width, height };
    page.allocations.delete(entry);
    page.allocations.set(reused, allocation);
    return reused;
  }

  private place(page: AtlasPage, width: number, height: number): AtlasEntry | undefined {
    const allocation = page.packer.allocate(width, height);
    if (allocation === undefined) return undefined;
    const entry: AtlasEntry = { page: page.page, x: allocation.x, y: allocation.y, width, height };
    page.allocations.set(entry, allocation);
    return entry;
  }

  private pageOf(entry: AtlasEntry): AtlasPage {
    const page = this.pages.find((candidate) => candidate.page === entry.page);
    if (page === undefined) throw new RangeError(`Atlas page ${String(entry.page)} is not live.`);
    return page;
  }
}
