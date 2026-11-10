import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBindGroupEntry } from '../../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';
import type { GpuSampler, GpuTexture } from '../../gpu/gpu-texture.js';
import type { AtlasPage, GlyphAtlas } from '../atlas/glyph-atlas.js';
import {
  TEXT_BINDINGS,
  TEXT_PAGE_TEXTURE_BINDINGS,
  TEXT_PAGE_UNIFORM_BYTES,
  textPageUniform,
} from '../renderer/text-pipeline.js';

/** One atlas page on the GPU: its texture and its uniform values. */
interface PageResources {
  readonly texture: GpuTexture;
  /** The page's `AtlasPage` uniform values (16 bytes). */
  readonly uniform: Float32Array<ArrayBuffer>;
}

/** A page group on the GPU: its uniform of every slot's `AtlasPage` and its bind entries. */
interface GroupResources {
  readonly uniform: GpuBuffer;
  entries: readonly GpuBindGroupEntry[];
}

/** Where a page draws from: its page group, and its index in the group. */
export interface PagePlacement {
  /** The group: the draw list's page, `floor(slot / pagesPerGroup)`. */
  readonly group: number;
  /** The index in the group, `slot % pagesPerGroup`: the record's page index. */
  readonly index: number;
}

/** A page the atlas does not hold draws from the first slot of the first group. */
const UNKNOWN_PLACEMENT: PagePlacement = { group: 0, index: 0 };

/** The blank page's uniform: a 1 × 1 single-channel page. */
const BLANK_PAGE_UNIFORM = textPageUniform({ id: -1, field: 'sdf', format: 'r8unorm', size: 1 });

/**
 * The glyph atlas's pages on the GPU for the scene's text passes (as `TextRenderer.prepare` keeps
 * them): a texture per atlas page, created when a page appears, destroyed when the atlas
 * releases it, and glyph cells copied in as the atlas queues them.
 *
 * Pages are bound in groups: each live page takes the lowest free slot when it appears
 * and keeps it while it lives, and `pagesPerGroup` consecutive slots form a group, bound together
 * (one uniform of every slot's `AtlasPage`, the slots' textures, the sampler) so one draw covers
 * glyphs on any of its pages. `placementOf` gives a page's group and index; `entriesOf` a
 * group's bind group entries. With one page per group (the frame titles), a group is one page.
 * The thread that renders; `sync` only with no render pass open.
 */
export class TextAtlasPages {
  private readonly pages = new Map<number, PageResources>();
  /**
   * Each live page's slot, kept while it lives. Given when a page is first asked about,
   * which may be before `sync` makes its texture: records are written as glyphs land.
   */
  private readonly slotById = new Map<number, number>();
  /** The page id in each slot; undefined where a slot is free. */
  private readonly slots: (number | undefined)[] = [];
  /** The atlas's live page ids, as of `liveRevision`. */
  private liveIds = new Set<number>();
  private liveRevision: number | undefined;
  private readonly groups = new Map<number, GroupResources>();
  private readonly sampler: GpuSampler;
  /** A cleared 1 × 1 page, bound in empty slots and for groups without pages. */
  private blank: GpuTexture | undefined;
  /** A group of blank slots, for a group asked for that holds no page. */
  private blankGroup: GroupResources | undefined;
  private syncedRevision: number | undefined;
  private hasFailed = false;

  /**
   * Atlas revision whose uploads completed successfully.
   *
   * @returns Undefined before sync, after destruction or any failed upload on this renderer.
   */
  get uploadedRevision(): number | undefined {
    return this.hasFailed ? undefined : this.syncedRevision;
  }

  /**
   * Creates the sampler; pages come with `sync`.
   *
   * @param backend - The backend.
   * @param atlas - The atlas to mirror.
   * @param pagesPerGroup - Pages bound together, at most `TEXT_PAGE_TEXTURE_BINDINGS.length`;
   *   default 1, a page per group.
   * @throws {RangeError} When `pagesPerGroup` is not a whole number in that range.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly atlas: GlyphAtlas,
    private readonly pagesPerGroup = 1,
  ) {
    if (
      !Number.isInteger(pagesPerGroup) ||
      pagesPerGroup < 1 ||
      pagesPerGroup > TEXT_PAGE_TEXTURE_BINDINGS.length
    ) {
      throw new RangeError(
        `A page group holds 1 to ${String(TEXT_PAGE_TEXTURE_BINDINGS.length)} pages; received ${String(pagesPerGroup)}.`,
      );
    }
    this.sampler = backend.createSampler({
      filter: 'linear',
      addressMode: 'clamp-to-edge',
      label: 'scene glyph atlas',
    });
  }

  /**
   * Brings the GPU in line with the atlas: new pages, released pages, queued glyph uploads.
   *
   * @throws {RangeError} When a page is larger than the backend's `maxTextureSize`.
   */
  sync(): void {
    this.syncedRevision = undefined;
    const revision = this.atlas.revision;
    try {
      this.syncPages();
      this.syncedRevision = revision;
    } catch (error) {
      this.hasFailed = true;
      throw error;
    }
  }

  /**
   * Where a page's glyphs draw from: its group and its index in the group.
   *
   * @param pageId - The atlas page.
   * @returns Its placement; the first slot of the first group for a page the atlas does not hold.
   */
  placementOf(pageId: number): PagePlacement {
    const slot = this.slotById.get(pageId) ?? (this.isLive(pageId) ? this.reserve(pageId) : -1);
    if (slot < 0) return UNKNOWN_PLACEMENT;
    return { group: Math.floor(slot / this.pagesPerGroup), index: slot % this.pagesPerGroup };
  }

  /**
   * A group's bind group entries: the uniform of its slots' pages, each slot's texture (the
   * blank page where a slot is free) and the shared sampler. Changes, as a new array, whenever a
   * page joins or leaves the group.
   *
   * @param group - The group.
   * @returns The entries; a blank group's for a group without pages (records of text whose
   *   glyphs have not landed, which draw nothing).
   * @throws {Error} When called before the first `sync`.
   */
  entriesOf(group: number): readonly GpuBindGroupEntry[] {
    const resources = this.groups.get(group) ?? this.blankGroup;
    if (resources === undefined) throw new Error('Text atlas pages are drawn before sync().');
    return resources.entries;
  }

  /**
   * How many of a group's leading slots its records may name: one past its highest
   * slot that holds a page or is reserved for one, at least 1. The scene draws the group with
   * the text shader variant whose page switch covers just those slots
   * (`ScenePass.pageSlotsOf`).
   *
   * @param group - The group.
   * @returns The slots, 1 to the pages per group.
   */
  slotsOf(group: number): number {
    const first = group * this.pagesPerGroup;
    for (let index = this.pagesPerGroup - 1; index > 0; index -= 1) {
      if (this.slots[first + index] !== undefined) return index + 1;
    }
    return 1;
  }

  /** Frees every page texture, group uniform and the sampler. */
  destroy(): void {
    this.hasFailed = true;
    this.syncedRevision = undefined;
    for (const page of this.pages.values()) page.texture.destroy();
    for (const group of [...this.groups.values(), ...(this.blankGroup ? [this.blankGroup] : [])]) {
      group.uniform.destroy();
    }
    this.blank?.destroy();
    this.pages.clear();
    this.slotById.clear();
    this.slots.length = 0;
    this.liveRevision = undefined;
    this.groups.clear();
    this.blank = undefined;
    this.blankGroup = undefined;
    this.sampler.destroy();
  }

  private syncPages(): void {
    // Created here, outside any pass, since creating a group writes its uniform.
    this.blank ??= this.createTexture({ id: -1, field: 'sdf', format: 'r8unorm', size: 1 });
    this.blankGroup ??= this.createGroup(-1);
    const changed = new Set<number>();
    for (const [pageId, slot] of this.slotById) {
      if (this.isLive(pageId)) continue;
      this.pages.get(pageId)?.texture.destroy();
      this.pages.delete(pageId);
      this.slotById.delete(pageId);
      this.slots[slot] = undefined;
      changed.add(Math.floor(slot / this.pagesPerGroup));
    }
    for (const page of this.atlas.pages) {
      if (this.pages.has(page.id)) continue;
      const slot = this.slotById.get(page.id) ?? this.reserve(page.id);
      this.pages.set(page.id, {
        texture: this.createTexture(page),
        uniform: textPageUniform(page),
      });
      changed.add(Math.floor(slot / this.pagesPerGroup));
    }
    for (const group of changed) this.syncGroup(group);
    for (const upload of this.atlas.takeUploads()) {
      const page = this.pages.get(upload.pageId);
      if (page) this.backend.writeTexture(page.texture, upload.texels, upload.region);
    }
  }

  /**
   * Whether the atlas holds a page now (its live ids, refreshed when its revision moves).
   *
   * @param pageId - The page.
   * @returns Whether it is live.
   */
  private isLive(pageId: number): boolean {
    if (this.liveRevision !== this.atlas.revision) {
      this.liveIds = new Set(this.atlas.pages.map((page) => page.id));
      this.liveRevision = this.atlas.revision;
    }
    return this.liveIds.has(pageId);
  }

  /**
   * Gives a page the lowest slot no page holds.
   *
   * @param pageId - The page.
   * @returns Its slot.
   */
  private reserve(pageId: number): number {
    const free = this.slots.indexOf(undefined);
    const slot = free === -1 ? this.slots.length : free;
    this.slots[slot] = pageId;
    this.slotById.set(pageId, slot);
    return slot;
  }

  /**
   * Rewrites a group's uniform and entries from its slots, or frees it when none holds a page.
   *
   * @param group - The group.
   */
  private syncGroup(group: number): void {
    const pages = this.groupPages(group);
    const existing = this.groups.get(group);
    if (pages.every((page) => page === undefined)) {
      existing?.uniform.destroy();
      this.groups.delete(group);
      return;
    }
    const resources = existing ?? this.createGroup(group);
    this.backend.writeBuffer(resources.uniform, 0, this.groupUniform(pages));
    resources.entries = this.groupEntries(resources.uniform, pages);
    this.groups.set(group, resources);
  }

  /**
   * A group's pages, one per slot, undefined where a slot is free.
   *
   * @param group - The group; -1 for the blank group.
   * @returns The pages.
   */
  private groupPages(group: number): (PageResources | undefined)[] {
    return Array.from({ length: this.pagesPerGroup }, (ignored, index) => {
      const pageId = group < 0 ? undefined : this.slots[group * this.pagesPerGroup + index];
      return pageId === undefined ? undefined : this.pages.get(pageId);
    });
  }

  /**
   * Creates a group's uniform and entries, blank slots only until `syncGroup` fills them.
   *
   * @param group - The group; -1 for the blank group.
   * @returns The group.
   */
  private createGroup(group: number): GroupResources {
    const uniform = this.backend.createBuffer({
      usage: 'uniform',
      byteLength: this.pagesPerGroup * TEXT_PAGE_UNIFORM_BYTES,
      label: group < 0 ? 'scene glyph blank group' : `scene glyph group ${String(group)}`,
    });
    const pages = this.groupPages(-1);
    this.backend.writeBuffer(uniform, 0, this.groupUniform(pages));
    return { uniform, entries: this.groupEntries(uniform, pages) };
  }

  /**
   * The uniform of a group's slots, the blank page's values where a slot is free.
   *
   * @param pages - The group's pages, by slot.
   * @returns The floats.
   */
  private groupUniform(pages: readonly (PageResources | undefined)[]): Float32Array<ArrayBuffer> {
    const values = new Float32Array(this.pagesPerGroup * (TEXT_PAGE_UNIFORM_BYTES / 4));
    pages.forEach((page, index) => {
      values.set(page?.uniform ?? BLANK_PAGE_UNIFORM, index * (TEXT_PAGE_UNIFORM_BYTES / 4));
    });
    return values;
  }

  /**
   * A group's bind group entries: its uniform, its slots' textures in slot order, the sampler.
   *
   * @param uniform - The group's uniform.
   * @param pages - The group's pages, by slot.
   * @returns The entries.
   * @throws {Error} When called before the blank page exists.
   */
  private groupEntries(
    uniform: GpuBuffer,
    pages: readonly (PageResources | undefined)[],
  ): GpuBindGroupEntry[] {
    const blank = this.blank;
    if (blank === undefined) throw new Error('Text atlas pages are grouped before sync().');
    return [
      { binding: TEXT_BINDINGS.page, buffer: uniform },
      ...pages.map((page, index) => ({
        binding: TEXT_PAGE_TEXTURE_BINDINGS[index] ?? TEXT_BINDINGS.texture,
        texture: page?.texture ?? blank,
      })),
      { binding: TEXT_BINDINGS.sampler, sampler: this.sampler },
    ];
  }

  private createTexture(page: AtlasPage): GpuTexture {
    if (page.size > this.backend.capabilities.maxTextureSize) {
      throw new RangeError(
        `Atlas pages of ${String(page.size)} texels exceed the backend's ${String(this.backend.capabilities.maxTextureSize)}.`,
      );
    }
    return this.backend.createTexture({
      format: page.format,
      width: page.size,
      height: page.size,
      label: `scene glyph page ${String(page.id)}`,
    });
  }
}
