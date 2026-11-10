import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildShaderDirectory, shaderOutputs } from './shader-build.ts';

const ENGINE_SHADERS = fileURLToPath(new URL('../src/gpu/shaders/', import.meta.url));

const MINIMAL_WGSL = `@vertex
fn vertexMain(@location(0) corner: vec2f) -> @builtin(position) vec4f {
  return vec4f(corner, 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
`;

describe('shaderOutputs', () => {
  it('generates both GLSL ES 3.0 stages and a module that embeds the WGSL and both stages', () => {
    const outputs = shaderOutputs('minimal', MINIMAL_WGSL);
    expect(outputs.map(({ fileName }) => fileName)).toEqual([
      'minimal.vert.glsl',
      'minimal.frag.glsl',
      'minimal.generated.ts',
    ]);
    const [vertex, , module] = outputs;
    expect(vertex?.content.split('\n')[1]).toBe('#version 300 es');
    expect(module?.content).toContain('export const MINIMAL_SHADER: GpuShaderSource');
    expect(module?.content).toContain(JSON.stringify(MINIMAL_WGSL));
  });
});

describe('buildShaderDirectory', () => {
  let directory = '';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'shader-build-'));
    writeFileSync(join(directory, 'minimal.wgsl'), MINIMAL_WGSL);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports every missing output in check mode and writes nothing', () => {
    expect(buildShaderDirectory(directory, 'check')).toEqual({
      shaderCount: 1,
      staleFiles: ['minimal.vert.glsl', 'minimal.frag.glsl', 'minimal.generated.ts'],
    });
    expect(() => readFileSync(join(directory, 'minimal.generated.ts'))).toThrow();
  });

  it('finds nothing stale after write mode has run', () => {
    buildShaderDirectory(directory, 'write');
    expect(buildShaderDirectory(directory, 'check').staleFiles).toEqual([]);
  });

  it('reports the outputs a WGSL edit made stale, and only those', () => {
    buildShaderDirectory(directory, 'write');
    const greenFragment = MINIMAL_WGSL.replace('1.0, 0.0, 0.0', '0.0, 1.0, 0.0');
    writeFileSync(join(directory, 'minimal.wgsl'), greenFragment);
    expect(buildShaderDirectory(directory, 'check').staleFiles).toEqual([
      'minimal.frag.glsl',
      'minimal.generated.ts',
    ]);
  });

  it('finds the committed engine shaders up to date with their WGSL', () => {
    expect(buildShaderDirectory(ENGINE_SHADERS, 'check').staleFiles).toEqual([]);
  });
});
