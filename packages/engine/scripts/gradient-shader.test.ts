import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { clipShaderSource } from './clip-shader.ts';
import { gradientShaderSource, gradientVariantName } from './gradient-shader.ts';
import { moveShaderSource } from './move-shader.ts';
import { shaderOutputs } from './shader-build.ts';

// As the build reads a source: with the clip table included (clip-shader.ts).
const read = (name: string): string =>
  clipShaderSource(
    name,
    readFileSync(new URL(`../src/gpu/shaders/${name}.wgsl`, import.meta.url), 'utf8'),
  );

describe('gradientShaderSource', () => {
  it.each([
    ['sdf-shape', 'sdf-shape-gradient'],
    ['path', 'path-gradient'],
    ['solid-rect', 'rect-gradient'],
  ])('derives %s’s gradient variant, %s, reading the paint table', (solid, variant) => {
    expect(gradientVariantName(solid)).toBe(variant);
    const source = read(solid);
    const gradient = gradientShaderSource(solid, source) ?? '';
    expect(gradient).toContain('@group(0) @binding(1) var paintTable: texture_2d<f32>;');
    expect(gradient).toContain('@location(8) paintRow: f32,');
    // The vertex placement is the solid source's: only the paint row is passed on.
    const vertexOf = (wgsl: string) =>
      wgsl
        .slice(wgsl.indexOf('@vertex'), wgsl.indexOf('@fragment'))
        .split('\n')
        .filter((line) => !/paintRow|output\.(local|box|unit) =/.test(line));
    expect(vertexOf(gradient)).toEqual(vertexOf(source));
    const [vertex, fragment] = shaderOutputs(variant, gradient);
    expect(fragment?.content).toContain('texelFetch(_group_0_binding_1_fs');
    expect(vertex?.content).toContain('layout(location = 8) in float');
  });

  it('keeps the SDF and coverage of the solid shape shader', () => {
    const source = read('sdf-shape');
    const gradient = gradientShaderSource('sdf-shape', source) ?? '';
    const between = (wgsl: string, from: string, to: string) =>
      wgsl.slice(wgsl.indexOf(from), wgsl.indexOf(to));
    expect(between(gradient, 'fn roundedBoxDistance', '@fragment')).toBe(
      between(source, 'fn roundedBoxDistance', '@fragment'),
    );
    expect(gradient).toContain('let fillAlpha = paint.a * outer;');
    expect(gradient).toContain('paint.rgb * outer * fillShown');
  });

  it.each(['sdf-shape-gradient', 'path-gradient'])(
    'gives %s a retained-move variant beside the paint row',
    (variant) => {
      const solid = variant === 'path-gradient' ? 'path' : 'sdf-shape';
      const gradient = gradientShaderSource(solid, read(solid)) ?? '';
      const moved = moveShaderSource(variant, gradient) ?? '';
      expect(moved).toContain('@location(7) moveIndex: f32,\n  @location(8) paintRow: f32,');
      expect(shaderOutputs(`${variant}-move`, moved)[0]?.content).toContain(
        '_group_0_binding_4_vs',
      );
    },
  );

  it('leaves other shaders alone and fails when a solid source changes', () => {
    expect(gradientShaderSource('image', read('image'))).toBeUndefined();
    expect(gradientVariantName('image')).toBeUndefined();
    const changed = read('solid-rect').replace(
      'output.color = input.color;',
      'output.color = vec4f(1.0);',
    );
    expect(() => gradientShaderSource('solid-rect', changed)).toThrow(/gradient variant/);
  });
});
