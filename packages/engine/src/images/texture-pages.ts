import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuSampler, GpuTexture } from '../gpu/gpu-texture.js';

/**
 * The page of the placeholder texture: one white texel, bound by image records that have no
 * level yet and draw a flat colour instead.
 */
export const PLACEHOLDER_PAGE = 0;

/** The WGSL binding of an image page's texture (after the camera at 0). */
export const IMAGE_TEXTURE_BINDING = 1;

/** The WGSL binding of an image page's sampler. */
export const IMAGE_SAMPLER_BINDING = 2;

/**
 * The textures image records sample, each under a small page number (the scene pass's
 * `pageOf`): level textures, atlas pages and the placeholder at {@link PLACEHOLDER_PAGE}. Page
 * numbers of removed textures are reused, so they stay small (the draw list splits by page).
 * All pages share one linear, clamped sampler. On the thread that renders.
 */
export class TexturePages {
  private readonly textures: (GpuTexture | undefined)[] = [];
  private readonly entries: (readonly GpuBindGroupEntry[] | undefined)[] = [];
  private readonly freePages: number[] = [];
  private readonly sampler: GpuSampler;

  /**
   * Creates the sampler and the placeholder page.
   *
   * @param backend - The backend the pages live on.
   */
  constructor(private readonly backend: GpuBackend) {
    this.sampler = backend.createSampler({
      filter: 'linear',
      addressMode: 'clamp-to-edge',
      label: 'image',
    });
    this.add(this.createPlaceholder());
  }

  /**
   * The number of live pages, the placeholder included.
   *
   * @returns The count.
   */
  get size(): number {
    return this.textures.length - this.freePages.length;
  }

  /**
   * Gives a texture a page number.
   *
   * @param texture - The texture.
   * @returns Its page.
   */
  add(texture: GpuTexture): number {
    const page = this.freePages.pop() ?? this.textures.length;
    this.textures[page] = texture;
    this.entries[page] = undefined;
    return page;
  }

  /**
   * Destroys a page's texture and frees its number.
   *
   * @param page - The page; the placeholder cannot be removed.
   * @throws {RangeError} When the page is the placeholder or not live.
   */
  remove(page: number): void {
    const texture = this.textures[page];
    if (page === PLACEHOLDER_PAGE || texture === undefined) {
      throw new RangeError(`Page ${String(page)} is not a removable image page.`);
    }
    texture.destroy();
    this.textures[page] = undefined;
    this.entries[page] = undefined;
    this.freePages.push(page);
  }

  /**
   * A page's texture.
   *
   * @param page - The page.
   * @returns Its texture, or undefined when the page is not live.
   */
  textureOf(page: number): GpuTexture | undefined {
    return this.textures[page];
  }

  /**
   * The bind group entries of a page: its texture and the shared sampler. The same array is
   * returned while the page's texture stays the same.
   *
   * @param page - The page.
   * @returns The entries; the placeholder's for a page that is not live.
   * @throws {Error} When the placeholder itself is missing (after `destroy`).
   */
  entriesOf(page: number): readonly GpuBindGroupEntry[] {
    const live = this.textures[page] === undefined ? PLACEHOLDER_PAGE : page;
    let entries = this.entries[live];
    if (entries === undefined) {
      const texture = this.textures[live];
      if (texture === undefined) throw new Error('The placeholder page is missing.');
      entries = [
        { binding: IMAGE_TEXTURE_BINDING, texture },
        { binding: IMAGE_SAMPLER_BINDING, sampler: this.sampler },
      ];
      this.entries[live] = entries;
    }
    return entries;
  }

  /** Destroys every page, the placeholder and the sampler. */
  destroy(): void {
    for (const texture of this.textures) texture?.destroy();
    this.sampler.destroy();
    this.textures.length = 0;
    this.entries.length = 0;
    this.freePages.length = 0;
  }

  private createPlaceholder(): GpuTexture {
    const texture = this.backend.createTexture({
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      label: 'image placeholder',
    });
    this.backend.writeTexture(texture, new Uint8Array([255, 255, 255, 255]));
    return texture;
  }
}
