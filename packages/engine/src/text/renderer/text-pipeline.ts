import type { GpuRenderPipelineDescriptor } from '../../gpu/gpu-pipeline.js';
import { MSDF_TEXT_SHADER } from '../../gpu/shaders/msdf-text.generated.js';
import type { AtlasPage } from '../atlas/glyph-atlas.js';
import { DISTANCE_RANGE_PX } from '../atlas/glyph-bitmap.js';

import { GLYPH_INSTANCE_LAYOUT, GLYPH_QUAD_VERTEX_LAYOUT } from './glyph-instance.js';

/** WGSL bindings of the text pass, all in group 0. */
export const TEXT_BINDINGS = {
  /**
   * The engine's camera uniform (`clip = world × scale + offset`: `cameraClipTransform`, in its
   * first 16 bytes; `CameraUniform`), the block every scene pass binds here.
   */
  camera: 0,
  /** The atlas page uniform (`AtlasPage`, 16 bytes). */
  page: 1,
  /** The page texture. */
  texture: 2,
  /** The linear, clamping sampler. */
  sampler: 3,
} as const;

/**
 * The text pass's pipeline, as plain data: the MSDF shader (WGSL, and
 * its generated GLSL ES 3.0), a per-vertex unit quad and a per-glyph instance record, the
 * camera and page uniforms, the page texture and its sampler, and premultiplied blending. The
 * scene graph registers the pass from this; `TextRenderer` creates it on its own.
 */
export const TEXT_PIPELINE_DESCRIPTOR: GpuRenderPipelineDescriptor = {
  label: 'msdf-text',
  shader: MSDF_TEXT_SHADER,
  vertexBuffers: [GLYPH_QUAD_VERTEX_LAYOUT, GLYPH_INSTANCE_LAYOUT],
  bindings: [
    { binding: TEXT_BINDINGS.camera, kind: 'uniform-buffer' },
    { binding: TEXT_BINDINGS.page, kind: 'uniform-buffer' },
    { binding: TEXT_BINDINGS.texture, kind: 'texture', samplerBinding: TEXT_BINDINGS.sampler },
    { binding: TEXT_BINDINGS.sampler, kind: 'sampler' },
  ],
  blend: 'premultiplied',
};

/** Bytes of the atlas page uniform. */
export const TEXT_PAGE_UNIFORM_BYTES = 16;

/**
 * How many atlas pages the scene text pass binds at once: a page group, one draw for
 * glyphs on any of its pages. Eight page textures, the move transforms and the clip table stay
 * under the 16 sampled textures per stage both backends guarantee.
 */
export const TEXT_PAGES_PER_GROUP = 8;

/**
 * The WGSL bindings of a page group's textures, in slot order: the page texture's binding for
 * slot 0, then bindings 6 to 12 (4 and 5 are the scene's move transforms and clip table).
 */
export const TEXT_PAGE_TEXTURE_BINDINGS: readonly number[] = [
  TEXT_BINDINGS.texture,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
];

/**
 * The page mode the text shader reads: 0 for an MSDF page, 1 for a single-channel page,
 * 2 for a colour page, whose premultiplied texels are drawn as they are.
 *
 * @param page - The page.
 * @returns The mode.
 */
export function pageModeOf(page: Pick<AtlasPage, 'field' | 'format'>): number {
  if (page.field === 'colour') return 2;
  return page.format === 'r8unorm' ? 1 : 0;
}

/**
 * Encodes an atlas page's uniform (the WGSL `AtlasPage` struct).
 *
 * @param page - The page.
 * @returns The uniform's 16 bytes as floats.
 */
export function textPageUniform(page: AtlasPage): Float32Array<ArrayBuffer> {
  return Float32Array.from([page.size, page.size, DISTANCE_RANGE_PX, pageModeOf(page)]);
}
