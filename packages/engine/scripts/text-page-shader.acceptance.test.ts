import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clipShaderSource } from './clip-shader.ts';
import { buildShaderDirectory } from './shader-build.ts';
import { textPageVariantSource } from './text-page-shader.ts';

const SHADER_DIRECTORY = new URL('../src/gpu/shaders/', import.meta.url);
const original = clipShaderSource(
  'scene-text',
  readFileSync(new URL('scene-text.wgsl', SHADER_DIRECTORY), 'utf8'),
);
const slots = [1, 2, 4] as const;

function stage(count: number, kind: 'vert' | 'frag'): string {
  return readFileSync(
    new URL(`scene-text-pages-${String(count)}.${kind}.glsl`, SHADER_DIRECTORY),
    'utf8',
  );
}

describe('scene text page shader variants', () => {
  it.each(slots)('limits the %i-slot switch and fragment samplers to reachable pages', (count) => {
    const variant = textPageVariantSource('scene-text', original, count);
    expect(variant).toBeDefined();
    const loads = [...(variant ?? '').matchAll(/textureLoad\(atlasTexture(\d+), texel, 0\)/g)].map(
      (match) => Number(match[1]),
    );
    expect(new Set(loads)).toEqual(new Set(Array.from({ length: count }, (value, i) => i)));
    const fragment = stage(count, 'frag');
    const samplers = [
      ...fragment.matchAll(/uniform highp sampler2D _group_0_binding_(\d+)_fs/g),
    ].map((match) => Number(match[1]));
    expect(samplers).toHaveLength(count + 1);
    expect(samplers).toContain(5); // Clip table.
    expect(new Set(samplers.filter((binding) => binding !== 5))).toEqual(
      new Set([2, 6, 7, 8].slice(0, count)),
    );
  });

  it.each(slots)('retains all bindings and clips page indexes beyond %i', (count) => {
    const variant = textPageVariantSource('scene-text', original, count) ?? '';
    const bindings = (source: string): number[] =>
      [...source.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((match) => Number(match[1]));
    expect(bindings(variant)).toEqual(bindings(original));
    expect(variant).toContain(`if (output.pageIndex >= ${String(count)}u)`);
    expect(variant).toContain('output.position = vec4f(0.0, 0.0, 2.0, 1.0);');
    expect(stage(count, 'vert')).toContain('2.0');
  });

  it('keeps the canonical scene-text source and committed outputs unchanged', () => {
    expect(original).toContain('switch index');
    expect(original).not.toContain('Generated page-count variant');
    expect(buildShaderDirectory(SHADER_DIRECTORY.pathname, 'check').staleFiles).toEqual([]);
  });

  it.each([
    ['switch index {', 'switch 0u {'],
    ['output.pageIndex = u32(clamp(round(input.pageIndex), 0.0, 7.0));', 'output.pageIndex = 0u;'],
  ])('fails the shader build when scene-text loses %s', (line, replacement) => {
    const directory = mkdtempSync(join(tmpdir(), 'text-page-shader-'));
    try {
      const source = readFileSync(new URL('scene-text.wgsl', SHADER_DIRECTORY), 'utf8');
      expect(source).toContain(line);
      writeFileSync(join(directory, 'scene-text.wgsl'), source.replace(line, replacement));
      expect(() => buildShaderDirectory(directory, 'check')).toThrow(/page switch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
