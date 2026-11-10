import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { clipShaderSource } from './clip-shader.ts';
import { imageFillShaderSource, imageFillVariantName } from './image-fill-shader.ts';
import { moveShaderSource } from './move-shader.ts';
import { shaderOutputs } from './shader-build.ts';

// The image-fill variant of the SDF shape shader keeps the solid source's SDF, radius,
// outline and coverage, and fits WebGL2's attribute and varying limits.

/** WebGL2's guaranteed vertex attributes (MAX_VERTEX_ATTRIBS). */
const WEBGL2_MAX_ATTRIBUTES = 16;

/** WebGL2's guaranteed varying vectors (MAX_VARYING_VECTORS). */
const WEBGL2_MAX_VARYINGS = 15;

// As the build reads a source: with the clip table included (clip-shader.ts).
const read = (name: string): string =>
  clipShaderSource(
    name,
    readFileSync(new URL(`../src/gpu/shaders/${name}.wgsl`, import.meta.url), 'utf8'),
  );

const between = (wgsl: string, from: string, to: string): string =>
  wgsl.slice(wgsl.indexOf(from), wgsl.indexOf(to));

describe('imageFillShaderSource', () => {
  it('derives only the SDF shape’s variant, sdf-shape-image', () => {
    expect(imageFillVariantName('sdf-shape')).toBe('sdf-shape-image');
    expect(imageFillVariantName('path')).toBeUndefined();
    expect(imageFillShaderSource('path', read('path'))).toBeUndefined();
  });

  it('samples the page where the solid shader took its fill colour, nothing else changed', () => {
    const source = read('sdf-shape');
    const variant = imageFillShaderSource('sdf-shape', source) ?? '';
    expect(variant).toContain('@group(0) @binding(1) var pageTexture: texture_2d<f32>;');
    expect(variant).toContain('@group(0) @binding(2) var pageSampler: sampler;');
    expect(variant).toContain('@location(8) uvRect: vec4f,');
    expect(variant).toContain('let fillAlpha = paint.a * outer;');
    expect(variant).toContain('paint.rgb * outer * fillShown');
    // The distance functions and the vertex placement are the solid source's.
    const sdf = (wgsl: string) => between(wgsl, 'fn roundedBoxDistance', '@fragment');
    expect(sdf(variant)).toBe(sdf(source));
    const placement = (wgsl: string) => between(wgsl, '@vertex', '  output.pixel = camera.pixel;');
    expect(placement(variant)).toBe(placement(source));
  });

  it('filters a tile across its crop’s opposite edges by hand, in the crop’s own texels', () => {
    const variant = imageFillShaderSource('sdf-shape', read('sdf-shape')) ?? '';
    // The sampler clamps at the atlas entry, so repeat blends four virtual texels of the crop
    // itself, wrapped by index: the expressions the mirror below follows.
    expect(variant).toContain('let span = max((uvRect.zw - uvRect.xy) * dims, vec2f(1e-3));');
    expect(variant).toContain('let count = max(ceil(span - vec2f(1e-3)), vec2f(1.0));');
    expect(variant).toContain('let at = fract(t) * count - vec2f(0.5);');
    expect(variant).toContain('let wrapped = index - count * floor(index / count);');
    expect(variant).toContain('(start + (wrapped + vec2f(0.5)) * span / count) / dims');
    expect(variant.match(/textureSampleLevel\(pageTexture/g)).toHaveLength(5);
  });

  it('keeps a fractional crop’s detail and joins every crop’s tiles without a seam (one axis)', () => {
    // One axis of the shader's repeat over a 10-texel page whose texel i holds the value i, read
    // by a linear clamp-to-edge sampler, the region the whole page: the mirror of `cropTap` and
    // the blend above.
    const dims = 10;
    const sample = (u: number): number => Math.min(Math.max(u * dims - 0.5, 0), dims - 1);
    const fill = (t: number, u0: number, u1: number): number => {
      const start = u0 * dims;
      const span = Math.max((u1 - u0) * dims, 1e-3);
      const count = Math.max(Math.ceil(span - 1e-3), 1);
      const low = 0.5 / dims;
      const high = 1 - 0.5 / dims;
      const tap = (index: number): number => {
        const wrapped = index - count * Math.floor(index / count);
        const u = (start + (wrapped + 0.5) * (span / count)) / dims;
        return sample(Math.min(Math.max(u, low), high));
      };
      const at = (t - Math.floor(t)) * count - 0.5;
      const first = Math.floor(at);
      const blend = at - first;
      return tap(first) * (1 - blend) + tap(first + 1) * blend;
    };
    const jumpAt = (u0: number, u1: number): number =>
      Math.abs(fill(0.9999, u0, u1) - fill(1.0001, u0, u1));
    // The review's cases: a crop 1.4 texels wide (texels 3 to 4.4) varies across the tile, and its
    // tile boundary is continuous (the old grid-tied weights jumped 2.64 to 3.20).
    const values = Array.from({ length: 21 }, (unused, i) => fill(i / 20, 0.3, 0.44));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.15);
    expect(jumpAt(0.3, 0.44)).toBeLessThan(0.01);
    // Other spans off the grid, and a whole 4-texel crop, whose boundary blends its last texel
    // (5) into its first (2) where a seam would jump by 3.
    for (const [u0, u1] of [
      [0.13, 0.37],
      [0.05, 0.66],
      [0.2, 0.6],
    ] as const) {
      expect(jumpAt(u0, u1)).toBeLessThan(0.01);
    }
    // On the grid the virtual texels are the crop's own: t 0.375 is the centre of texel 3.
    expect(fill(0.375, 0.2, 0.6)).toBeCloseTo(3);
  });

  it('names the expression it no longer finds', () => {
    const source = read('sdf-shape').replace('  let fillAlpha = input.color.a * outer;', '');
    expect(() => imageFillShaderSource('sdf-shape', source)).toThrow(/let fillAlpha/);
  });

  it('compiles for WebGL2 within its attribute and varying limits, move variant included', () => {
    const variant = imageFillShaderSource('sdf-shape', read('sdf-shape')) ?? '';
    const move = moveShaderSource('sdf-shape-image', variant) ?? '';
    expect(move).toContain('@location(7) moveIndex');
    for (const [name, wgsl] of [
      ['sdf-shape-image', variant],
      ['sdf-shape-image-move', move],
    ] as const) {
      const [vertex, fragment] = shaderOutputs(name, wgsl);
      const glsl = vertex?.content ?? '';
      const attributes = glsl.match(/^layout\(location = \d+\) in /gm) ?? [];
      const varyings = glsl.match(/^(smooth|flat) out /gm) ?? [];
      expect(attributes.length).toBeLessThanOrEqual(WEBGL2_MAX_ATTRIBUTES);
      expect(varyings.length).toBeLessThanOrEqual(WEBGL2_MAX_VARYINGS);
      expect(fragment?.content).toContain('textureLod(_group_0_binding_1_fs');
    }
  });
});
