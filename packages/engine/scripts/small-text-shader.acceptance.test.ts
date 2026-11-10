import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SHADERS = new URL('../src/gpu/shaders/', import.meta.url);
const NAMES = ['scene-text', 'frame-title'] as const;

/**
 * Read a canonical WGSL source or checked-in generated fragment shader.
 *
 * @param name - Shader file name.
 * @returns The shader source.
 */
function shader(name: string): string {
  return readFileSync(new URL(name, SHADERS), 'utf8');
}

/**
 * Keep the fragment body distinct from helper definitions.
 *
 * @param source - Canonical WGSL source.
 * @returns The fragment body.
 */
function fragment(source: string): string {
  return source.slice(source.indexOf('@fragment'));
}

describe.each(NAMES)('%s gamma-corrected coverage', (name) => {
  it('corrects the final glyph-or-bar coverage before using it as alpha', () => {
    const body = fragment(shader(`${name}.wgsl`));
    expect(body).toMatch(/let\s+coverage\s*=\s*select\(glyphCoverage,\s*barCoverage,/);
    expect(body).toMatch(/gammaCorrectedCoverage\(coverage,\s*input\.color\.rgb\)/);
    const corrected =
      /let\s+(\w+)\s*=\s*gammaCorrectedCoverage\(coverage,\s*input\.color\.rgb\)/.exec(body);
    if (corrected === null) {
      expect(body).toMatch(
        /let\s+alpha\s*=\s*input\.color\.a\s*\*\s*gammaCorrectedCoverage\(coverage,\s*input\.color\.rgb\)/,
      );
    } else {
      expect(body).toMatch(
        new RegExp(`let\\s+alpha\\s*=\\s*input\\.color\\.a\\s*\\*\\s*${corrected[1] ?? ''}\\s*;`),
      );
    }
  });

  it('names the 0.15 px darkening, 12–24 px fade and 64 px/em tier', () => {
    const source = shader(`${name}.wgsl`);
    const constants = [
      ...source.matchAll(/const\s+([A-Za-z][A-Za-z\d_]*)\s*:\s*f32\s*=\s*(\d+(?:\.\d+)?)/g),
    ];
    for (const value of [0.15, 12, 24, 64]) {
      expect(constants.some((match) => Number(match[2]) === value)).toBe(true);
    }
    const byValue = (value: number): string =>
      constants.find((match) => Number(match[2]) === value)?.[1] ?? 'missingConstant';
    expect(source).toMatch(
      new RegExp(
        `let\\s+emPx\\s*=\\s*${byValue(64)}\\s*\\*\\s*screenPxRange\\s*\\/\\s*page\\.distanceRangeTexels`,
      ),
    );
    expect(source).toMatch(
      new RegExp(
        `let\\s+darkenPx\\s*=\\s*${byValue(0.15)}\\s*\\*\\s*clamp\\s*\\(\\s*\\(\\s*${byValue(24)}\\s*-\\s*emPx\\s*\\)\\s*\\/\\s*${byValue(12)}\\s*,\\s*0\\.0\\s*,\\s*1\\.0`,
      ),
    );
    expect(source).toMatch(
      /let\s+glyphCoverage\s*=\s*clamp\([^;]*\+\s*darkenPx\s*,\s*0\.0\s*,\s*1\.0\)/,
    );
  });
});

it('preserves scene-text colour glyph texels as premultiplied atlas colours', () => {
  const body = fragment(shader('scene-text.wgsl'));
  expect(body).toMatch(
    /select\(vec4f\(input\.color\.rgb\s*\*\s*alpha,\s*alpha\),\s*texel\s*\*\s*input\.color\.a,\s*isColour\)/,
  );
  expect(body).not.toMatch(/gammaCorrectedCoverage\([^)]*texel/);
});

it.each(['scene-text', 'scene-text-move', 'frame-title', 'frame-title-move'])(
  '%s generated fragment includes gamma correction and darkening',
  (name) => {
    const source = shader(`${name}.frag.glsl`);
    expect(source).toMatch(/float\s+toLinear\s*\(/);
    expect(source).toMatch(/float\s+toEncoded\s*\(/);
    expect(source).toMatch(/float\s+gammaCorrectedCoverage\s*\(/);
    expect(source).toMatch(/gammaCorrectedCoverage\s*\(/g);
    expect(source).toMatch(/\b0\.15\b/);
    expect(source).toMatch(/\b12\.0\b/);
    expect(source).toMatch(/\b24\.0\b/);
    expect(source).toMatch(/\b64\.0\b/);
  },
);
