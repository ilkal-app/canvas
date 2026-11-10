import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { clipShaderSource } from './clip-shader.ts';
import { gammaShaderSource } from './coverage-gamma-shader.ts';
import { moveShaderSource } from './move-shader.ts';
import { shaderOutputs } from './shader-build.ts';

describe('moveShaderSource', () => {
  it.each(['sdf-shape', 'scene-text', 'image', 'path'])(
    'preserves %s fragment work and compiles integer vertex loads',
    (name) => {
      // As the build reads it (shader-build.ts): with the clip table and the gamma functions
      // included (clip-shader.ts, coverage-gamma-shader.ts).
      const source = gammaShaderSource(
        name,
        clipShaderSource(
          name,
          readFileSync(new URL(`../src/gpu/shaders/${name}.wgsl`, import.meta.url), 'utf8'),
        ),
      );
      const moved = moveShaderSource(name, source);
      expect(moved).toBeDefined();
      expect(moved?.slice(moved.indexOf('@fragment'))).toBe(
        source.slice(source.indexOf('@fragment')),
      );
      const outputs = shaderOutputs(`${name}-move`, moved ?? '');
      expect(outputs[0]?.content).toContain('texelFetch(');
      expect(outputs[0]?.content).toContain('_group_0_binding_4_vs');
      expect(moved).toContain('@location(7) moveIndex: f32');
      expect(moved).toContain('if (index == 0.0) { return fallback; }');
    },
  );

  it('leaves unsupported shaders alone', () => {
    expect(moveShaderSource('custom', '')).toBeUndefined();
  });

  it('fails generation if a canonical placement expression changes', () => {
    const source = readFileSync(new URL('../src/gpu/shaders/path.wgsl', import.meta.url), 'utf8');
    expect(() =>
      moveShaderSource('path', source.replaceAll('input.placement', 'input.frame')),
    ).toThrow(/placement/);
  });
});
