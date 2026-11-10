import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';

import { GLYPH_INSTANCE_BYTES, writeGlyphInstance, type GlyphQuad } from './glyph-instance.js';
import type { GlyphQuads } from './glyph-quads.js';

/** A run of glyph instances in one page's buffer: what `TextRenderer.draw` draws. */
export interface GlyphInstanceRange {
  /** The atlas page the glyphs sample. */
  readonly pageId: number;
  /** The page's instance buffer. */
  readonly buffer: GpuBuffer;
  /** The first instance record. */
  readonly firstInstance: number;
  /** How many instances. */
  readonly instanceCount: number;
}

/** Where one text box's glyphs went in a batch: a span per page. */
export interface GlyphSpan {
  /** The atlas page. */
  readonly pageId: number;
  /** The first instance record. */
  readonly firstInstance: number;
  /** How many instances. */
  readonly instanceCount: number;
}

interface PageInstances {
  quads: GlyphQuad[];
  buffer: GpuBuffer | undefined;
}

/**
 * Collects the glyph quads of many text boxes into one instance buffer per atlas page, so a
 * page draws in one call, or in `firstInstance` ranges when z-order segments split it (the
 * prototype's per-page `InstanceBuffer`). Standalone until the scene graph owns persistent
 * instance buffers with dirty ranges; here a batch is refilled when its text or the
 * atlas changes. Buffers grow by doubling and are reused across refills.
 */
export class GlyphInstanceBatch {
  private readonly pages = new Map<number, PageInstances>();

  /**
   * Creates an empty batch.
   *
   * @param backend - Creates and writes the instance buffers.
   */
  constructor(private readonly backend: GpuBackend) {}

  /** Empties the batch; its buffers are kept for the next fill. */
  clear(): void {
    for (const page of this.pages.values()) page.quads = [];
  }

  /**
   * Appends one text box's quads.
   *
   * @param glyphs - The box's quads by page.
   * @returns Where they went: one span per page.
   */
  add(glyphs: GlyphQuads): GlyphSpan[] {
    const spans: GlyphSpan[] = [];
    for (const [pageId, quads] of glyphs.quadsByPage) {
      let page = this.pages.get(pageId);
      if (page === undefined) {
        page = { quads: [], buffer: undefined };
        this.pages.set(pageId, page);
      }
      spans.push({ pageId, firstInstance: page.quads.length, instanceCount: quads.length });
      page.quads.push(...quads);
    }
    return spans;
  }

  /**
   * Writes every page's instances to its GPU buffer. Call outside a render pass.
   *
   * @returns One range per page covering all its instances.
   */
  upload(): GlyphInstanceRange[] {
    const ranges: GlyphInstanceRange[] = [];
    for (const [pageId, page] of this.pages) {
      if (page.quads.length === 0) continue;
      const byteLength = page.quads.length * GLYPH_INSTANCE_BYTES;
      if (page.buffer === undefined || page.buffer.byteLength < byteLength) {
        page.buffer?.destroy();
        const capacity = Math.max(byteLength, (page.buffer?.byteLength ?? 0) * 2);
        page.buffer = this.backend.createBuffer({
          usage: 'vertex',
          byteLength: capacity,
          label: `glyph-instances-${String(pageId)}`,
        });
      }
      const bytes = new DataView(new ArrayBuffer(byteLength));
      page.quads.forEach((quad, index) => {
        writeGlyphInstance(bytes, index, quad);
      });
      this.backend.writeBuffer(page.buffer, 0, new Uint8Array(bytes.buffer));
      ranges.push({
        pageId,
        buffer: page.buffer,
        firstInstance: 0,
        instanceCount: page.quads.length,
      });
    }
    return ranges;
  }

  /**
   * The drawable range of a span, after {@link GlyphInstanceBatch.upload}.
   *
   * @param span - A span {@link GlyphInstanceBatch.add} returned.
   * @returns The range, with its page's buffer.
   * @throws {Error} When the span's page has not been uploaded.
   */
  rangeOf(span: GlyphSpan): GlyphInstanceRange {
    const buffer = this.pages.get(span.pageId)?.buffer;
    if (buffer === undefined) throw new Error(`Page ${String(span.pageId)} has not been uploaded.`);
    return { ...span, buffer };
  }

  /** Frees every buffer. The batch must not be used afterwards. */
  destroy(): void {
    for (const page of this.pages.values()) page.buffer?.destroy();
    this.pages.clear();
  }
}
