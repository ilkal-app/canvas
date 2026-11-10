import { describe, expect, it } from 'vitest';

import { GAMMA_FUNCTIONS, gammaShaderSource } from './coverage-gamma-shader.ts';

const SHADER = `struct VertexInput {\n  @location(0) position: vec2f,\n}\n`;

describe('gammaShaderSource', () => {
  it('includes the gamma functions before the vertex input of a shader that calls them', () => {
    const source = `${SHADER}fn main() { let a = gammaCorrectedCoverage(0.5, vec3f(0.1)); }\n`;
    const included = gammaShaderSource('glyph-edge', source);
    expect(included.indexOf(GAMMA_FUNCTIONS)).toBe(0);
    expect(included.indexOf('struct VertexInput {')).toBeGreaterThan(0);
  });

  it('leaves a shader that does not call them unchanged', () => {
    expect(gammaShaderSource('path', SHADER)).toBe(SHADER);
  });

  it('refuses a shader with its own copy', () => {
    const source = `${SHADER}fn gammaCorrectedCoverage(c: f32, k: vec3f) -> f32 { return c; }\n`;
    expect(() => gammaShaderSource('glyph-edge', source)).toThrow(/is included/);
  });
});
