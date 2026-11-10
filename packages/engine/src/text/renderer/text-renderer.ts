import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../../gpu/gpu-render-pass.js';
import type { GpuSampler, GpuTexture } from '../../gpu/gpu-texture.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';

import type { GlyphInstanceRange } from './glyph-instance-batch.js';
import { GLYPH_QUAD_CORNERS, GLYPH_QUAD_VERTEX_COUNT } from './glyph-instance.js';
import {
  TEXT_BINDINGS,
  TEXT_PAGE_UNIFORM_BYTES,
  TEXT_PIPELINE_DESCRIPTOR,
  textPageUniform,
} from './text-pipeline.js';

/** The GPU side of one atlas page. */
interface PageResources {
  readonly texture: GpuTexture;
  readonly uniform: GpuBuffer;
  /** Bind groups by camera uniform buffer. */
  readonly bindGroups: Map<GpuBuffer, GpuBindGroup>;
}

/**
 * Draws MSDF text through a `GpuBackend` (the prototype's `TextRenderer`,
 * `src/render/textRenderer.ts`): one pipeline from one WGSL source, one texture per atlas page
 * (RGBA8 MSDF or R8 fallback), glyph quads as instances drawn by `firstInstance` range,
 * premultiplied output. {@link TextRenderer.prepare} mirrors the atlas onto the GPU (new pages,
 * released pages, queued glyph uploads as sub-region writes) and must run before the frame's passes
 * begin, since writes are rejected inside an open pass; {@link TextRenderer.draw} only records
 * draws.
 */
export class TextRenderer {
  private readonly pipeline: GpuRenderPipeline;
  private readonly sampler: GpuSampler;
  private readonly quad: GpuBuffer;
  private readonly pages = new Map<number, PageResources>();

  /**
   * Creates the pipeline, the sampler and the unit quad.
   *
   * @param backend - The GPU backend.
   * @param atlas - The glyph atlas whose pages it draws from.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly atlas: GlyphAtlas,
  ) {
    this.pipeline = backend.createRenderPipeline(TEXT_PIPELINE_DESCRIPTOR);
    this.sampler = backend.createSampler({
      filter: 'linear',
      addressMode: 'clamp-to-edge',
      label: 'glyph-atlas',
    });
    this.quad = backend.createBuffer({
      usage: 'vertex',
      byteLength: GLYPH_QUAD_CORNERS.byteLength,
      label: 'glyph-quad',
    });
    backend.writeBuffer(this.quad, 0, GLYPH_QUAD_CORNERS);
  }

  /**
   * Brings the GPU in line with the atlas: creates textures for new pages, destroys those of
   * released pages, and copies queued glyph cells into their pages. Call once per frame, before
   * any pass begins.
   *
   * @throws {RangeError} When an atlas page is larger than the backend's `maxTextureSize`.
   * @throws {Error} When a render pass is open.
   */
  prepare(): void {
    const live = new Set<number>();
    for (const page of this.atlas.pages) {
      live.add(page.id);
      if (this.pages.has(page.id)) continue;
      if (page.size > this.backend.capabilities.maxTextureSize) {
        throw new RangeError(
          `Atlas pages of ${String(page.size)} texels exceed the backend's ${String(this.backend.capabilities.maxTextureSize)}.`,
        );
      }
      const texture = this.backend.createTexture({
        format: page.format,
        width: page.size,
        height: page.size,
        label: `glyph-page-${String(page.id)}`,
      });
      const uniform = this.backend.createBuffer({
        usage: 'uniform',
        byteLength: TEXT_PAGE_UNIFORM_BYTES,
        label: `glyph-page-${String(page.id)}`,
      });
      this.backend.writeBuffer(uniform, 0, textPageUniform(page));
      this.pages.set(page.id, { texture, uniform, bindGroups: new Map() });
    }
    for (const [pageId, resources] of this.pages) {
      if (live.has(pageId)) continue;
      resources.texture.destroy();
      resources.uniform.destroy();
      this.pages.delete(pageId);
    }
    for (const upload of this.atlas.takeUploads()) {
      const resources = this.pages.get(upload.pageId);
      if (resources !== undefined)
        this.backend.writeTexture(resources.texture, upload.texels, upload.region);
    }
  }

  /**
   * Records the draw of a range of glyph instances into an open pass.
   *
   * @param pass - The open render pass.
   * @param cameraUniform - The engine's camera uniform, its first 16 bytes holding
   *   `cameraClipTransform` (the scene's `CameraUniform.buffer`).
   * @param range - The instances: their page, buffer and range.
   * @throws {Error} When the range's page has no texture: `prepare` was not called after the
   *   glyphs were added.
   */
  draw(pass: GpuRenderPass, cameraUniform: GpuBuffer, range: GlyphInstanceRange): void {
    if (range.instanceCount === 0) return;
    const resources = this.pages.get(range.pageId);
    if (resources === undefined) {
      throw new Error(`Atlas page ${String(range.pageId)} has no texture; call prepare() first.`);
    }
    let bindGroup = resources.bindGroups.get(cameraUniform);
    if (bindGroup === undefined) {
      bindGroup = this.backend.createBindGroup({
        pipeline: this.pipeline,
        entries: [
          { binding: TEXT_BINDINGS.camera, buffer: cameraUniform },
          { binding: TEXT_BINDINGS.page, buffer: resources.uniform },
          { binding: TEXT_BINDINGS.texture, texture: resources.texture },
          { binding: TEXT_BINDINGS.sampler, sampler: this.sampler },
        ],
        label: `glyph-page-${String(range.pageId)}`,
      });
      resources.bindGroups.set(cameraUniform, bindGroup);
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(bindGroup);
    pass.setVertexBuffer(0, this.quad);
    pass.setVertexBuffer(1, range.buffer);
    pass.draw(GLYPH_QUAD_VERTEX_COUNT, range.instanceCount, 0, range.firstInstance);
  }

  /** Frees the pipeline, sampler, quad and every page texture. */
  destroy(): void {
    for (const resources of this.pages.values()) {
      resources.texture.destroy();
      resources.uniform.destroy();
    }
    this.pages.clear();
    this.quad.destroy();
    this.sampler.destroy();
    this.pipeline.destroy();
  }
}
