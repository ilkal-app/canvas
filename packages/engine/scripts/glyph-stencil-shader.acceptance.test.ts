// Pin the stencil-only WGSL, its retained-move variant and generated outputs.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isClippedShader } from './clip-shader.ts';
import { moveShaderSource } from './move-shader.ts';

const SHADERS = new URL('../src/gpu/shaders/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, SHADERS), 'utf8');

describe('glyph stencil shader', () => {
  it('transforms box-frame glyph vertices and discards only outside the Loop–Blinn curve', () => {
    expect(existsSync(new URL('glyph-stencil.wgsl', SHADERS))).toBe(true);
    const source = read('glyph-stencil.wgsl');
    expect(source).toMatch(/@location\(0\)\s+position:\s*vec2f/);
    expect(source).toMatch(/@location\(1\)\s+placement:\s*vec4f/);
    expect(source).toMatch(/@location\(3\)\s+curve:\s*vec2f/);
    expect(source).toContain('input.placement.zw');
    expect(source).toContain('input.placement.xy');
    expect(source).toContain('world * camera.scale + camera.offset');
    expect(source).toMatch(
      /if\s*\(\s*input\.curve\.x\s*\*\s*input\.curve\.x\s*-\s*input\.curve\.y\s*>\s*0\.0\s*\)\s*\{\s*discard;/,
    );
    expect(source).not.toMatch(/\bclipVertex\b|\bclipCoverage\b|\blayerAlpha\b/);
    expect(source).not.toMatch(/@location\(2\)\s+color|input\.color|output\.color/);
  });

  it('generates a move variant that reads the placement table', () => {
    const source = read('glyph-stencil.wgsl');
    const moved = moveShaderSource('glyph-stencil', source);
    expect(moved).toBeDefined();
    expect(moved).toContain('@location(7) moveIndex: f32');
    expect(moved).toContain('@group(0) @binding(4) var moveTransforms: texture_2d<f32>');
    expect(moved).toContain(
      'movePlacement(input.moveIndex, vec4f(input.placement.zw, input.placement.xy))',
    );
    expect(moved?.slice(moved.indexOf('@fragment'))).toBe(
      source.slice(source.indexOf('@fragment')),
    );
  });

  it.each(['glyph-stencil', 'glyph-stencil-move'])(
    '%s stays outside the scene clip contract and has generated GLSL and TypeScript',
    (name) => {
      expect(isClippedShader(name)).toBe(false);
      for (const suffix of ['vert.glsl', 'frag.glsl', 'generated.ts']) {
        expect(existsSync(new URL(`${name}.${suffix}`, SHADERS))).toBe(true);
      }
      const generated = read(`${name}.generated.ts`);
      expect(generated).not.toContain('clipCoverage(');
      expect(generated).not.toContain('clipVertex(');
    },
  );

  it('exports both generated sources from the engine GPU API', () => {
    const api = readFileSync(new URL('../src/gpu/gpu-api.ts', import.meta.url), 'utf8');
    expect(api).toContain(
      "export { GLYPH_STENCIL_SHADER } from './shaders/glyph-stencil.generated.js'",
    );
    expect(api).toContain(
      "export { GLYPH_STENCIL_MOVE_SHADER } from './shaders/glyph-stencil-move.generated.js'",
    );
  });
});
