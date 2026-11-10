import { describe, expect, it } from 'vitest';

import { resolveVertexBufferLayouts } from '../../gpu/vertex-layout.js';

import {
  GLYPH_INSTANCE_BYTES,
  GLYPH_QUAD_CORNERS,
  writeGlyphInstance,
  type GlyphQuad,
} from './glyph-instance.js';
import {
  TEXT_PAGE_UNIFORM_BYTES,
  TEXT_PIPELINE_DESCRIPTOR,
  textPageUniform,
} from './text-pipeline.js';

describe('TEXT_PIPELINE_DESCRIPTOR', () => {
  it('reads a unit-quad vertex and a 36-byte glyph instance', () => {
    const [quad, instance] = resolveVertexBufferLayouts(TEXT_PIPELINE_DESCRIPTOR.vertexBuffers);
    expect(quad).toMatchObject({ stepMode: 'vertex', byteStride: 8 });
    expect(instance).toMatchObject({ stepMode: 'instance', byteStride: GLYPH_INSTANCE_BYTES });
    expect(instance?.attributes.map(({ byteOffset }) => byteOffset)).toEqual([0, 16, 32]);
    expect(GLYPH_QUAD_CORNERS).toHaveLength(12);
  });

  it('binds the camera and page uniforms and the page texture with its sampler', () => {
    expect(TEXT_PIPELINE_DESCRIPTOR.bindings).toEqual([
      { binding: 0, kind: 'uniform-buffer' },
      { binding: 1, kind: 'uniform-buffer' },
      { binding: 2, kind: 'texture', samplerBinding: 3 },
      { binding: 3, kind: 'sampler' },
    ]);
    expect(TEXT_PIPELINE_DESCRIPTOR.blend).toBe('premultiplied');
    expect(TEXT_PIPELINE_DESCRIPTOR.shader.label).toBe('msdf-text');
    expect(TEXT_PIPELINE_DESCRIPTOR.shader.glslFragment).toContain('_group_0_binding_2_fs');
    // The engine's camera block, as every scene pass binds it.
    expect(TEXT_PIPELINE_DESCRIPTOR.shader.wgsl).toContain('scale: vec2f,\n  offset: vec2f,');
  });
});

describe('textPageUniform', () => {
  it('encodes a page: its size, the distance range and whether it is single-channel', () => {
    const rgba = textPageUniform({ id: 0, field: 'msdf', format: 'rgba8unorm', size: 2048 });
    expect(rgba.byteLength).toBe(TEXT_PAGE_UNIFORM_BYTES);
    expect([...rgba]).toEqual([2048, 2048, 16, 0]);
    expect([...textPageUniform({ id: 1, field: 'sdf', format: 'r8unorm', size: 1024 })]).toEqual([
      1024, 1024, 16, 1,
    ]);
  });
});

describe('writeGlyphInstance', () => {
  it('writes the rectangle, the page rectangle and a byte colour, clamped', () => {
    const bytes = new DataView(new ArrayBuffer(2 * GLYPH_INSTANCE_BYTES));
    const quad: GlyphQuad = {
      x: 1.5,
      y: -2,
      width: 10,
      height: 12,
      u0: 0.25,
      v0: 0.5,
      u1: 0.75,
      v1: 1,
      color: [1, 0.5, 0, 2],
    };
    writeGlyphInstance(bytes, 1, quad);
    const floats = new Float32Array(bytes.buffer, GLYPH_INSTANCE_BYTES, 8);
    expect([...floats]).toEqual([1.5, -2, 10, 12, 0.25, 0.5, 0.75, 1]);
    const colour = new Uint8Array(bytes.buffer, GLYPH_INSTANCE_BYTES + 32, 4);
    expect([...colour]).toEqual([255, 128, 0, 255]);
  });
});
