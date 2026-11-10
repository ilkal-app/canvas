import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CLIP_FUNCTIONS, clipShaderSource, isClippedShader } from './clip-shader.ts';
import { shaderOutputs } from './shader-build.ts';

const SHADERS = new URL('../src/gpu/shaders/', import.meta.url);

const read = (name: string): string => readFileSync(new URL(`${name}.wgsl`, SHADERS), 'utf8');

/**
 * The generated shaders that are not scene passes. curve-stencil is the stencil-only pass
 * of a non-zero fill with curved edges: it writes no colour, so a clip has nothing to fade there;
 * its discard is the curve itself (Loop–Blinn), and the cover pass that paints where it counted is
 * where clipping applies. glyph-stencil is the vector glyph tier's, in the scene's
 * camera and records: the same stencil-only pass, whose run's cover (path.wgsl) clips and fades. A
 * listed shader's generated move variant is not a scene pass either.
 */
const NOT_SCENE_SHADERS = [
  'curve-stencil',
  'dot-grid',
  'glyph-stencil',
  'layer-composite',
  'msdf-text',
  'parity-triangle',
];

/** Every generated scene shader: the six canonical ones and their gradient and move variants. */
const SCENE_SHADERS = readdirSync(SHADERS)
  .filter((file) => file.endsWith('.generated.ts'))
  .map((file) => file.replace('.generated.ts', ''))
  .filter((name) => !NOT_SCENE_SHADERS.includes(name.replace(/-move$/, '')));

describe('clipShaderSource', () => {
  it('includes the clip table before the vertex input of every scene pass shader', () => {
    for (const name of ['solid-rect', 'sdf-shape', 'image', 'path', 'scene-text', 'frame-title']) {
      expect(isClippedShader(name)).toBe(true);
      const included = clipShaderSource(name, read(name));
      expect(included.indexOf(CLIP_FUNCTIONS)).toBeGreaterThan(0);
      expect(included.indexOf(CLIP_FUNCTIONS)).toBeLessThan(
        included.indexOf('struct VertexInput {'),
      );
    }
  });

  it('leaves the shaders that are not scene passes alone', () => {
    for (const name of NOT_SCENE_SHADERS) {
      expect(isClippedShader(name)).toBe(false);
      expect(clipShaderSource(name, read(name))).toBe(read(name));
    }
  });

  it('fails the build when a scene shader stops applying its clip', () => {
    const source = read('image').replace(
      ' * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)',
      '',
    );
    expect(() => clipShaderSource('image', source)).toThrow(/no longer clips/);
  });

  it('fails the build when a scene shader stops fading with its layer', () => {
    const source = read('path').replace(
      'output.layerAlpha = layerAlpha(input.layerTransparency)',
      'output.layerAlpha = 1.0',
    );
    expect(() => clipShaderSource('path', source)).toThrow(/no longer fades/);
  });

  it('lets the frame title alone draw at full opacity: a name is not part of its layer', () => {
    const title = read('frame-title');
    expect(title).not.toContain('layerAlpha(input.layerTransparency)');
    expect(() => clipShaderSource('frame-title', title)).not.toThrow();
  });

  it('compiles the clip functions into both GLSL stages, the table in each', () => {
    const [vertex, fragment] = shaderOutputs(
      'solid-rect',
      clipShaderSource('solid-rect', read('solid-rect')),
    );
    expect(vertex?.content).toContain('uniform highp sampler2D _group_0_binding_5_vs;');
    expect(fragment?.content).toContain('uniform highp sampler2D _group_0_binding_5_fs;');
  });
});

/** The scene shaders that read their records from a texture, not from vertex inputs. */
const PULLED_SHADERS = ['path-batch'];

describe('the generated scene shaders', () => {
  it.each(SCENE_SHADERS.filter((name) => !PULLED_SHADERS.includes(name)))(
    '%s reads the clip index at location 14, the transparency at 12 and the table at binding 5, and never discards',
    (name) => {
      const wgsl = readFileSync(new URL(`${name}.generated.ts`, SHADERS), 'utf8');
      expect(wgsl).toContain('@location(14) clipIndex: f32');
      expect(wgsl).toContain('@location(12) layerTransparency: f32');
      expect(wgsl).toContain('@group(0) @binding(5) var clipTable: texture_2d<f32>;');
      expect(wgsl).toContain('clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)');
      // Coverage is multiplied in: the path pass's stencil operations must run where it clips.
      expect(wgsl).not.toMatch(/\bdiscard\b/);
    },
  );

  it.each(PULLED_SHADERS)(
    '%s reads the clip index and transparency from its record texture, the table at binding 5, and never discards',
    (name) => {
      const wgsl = readFileSync(new URL(`${name}.generated.ts`, SHADERS), 'utf8');
      expect(wgsl).toContain('@group(0) @binding(6) var records: texture_2d<f32>;');
      expect(wgsl).toContain('clipVertex(world, record.clipIndex, camera.pixel)');
      expect(wgsl).toContain('output.layerAlpha = layerAlpha(record.layerTransparency)');
      expect(wgsl).toContain('@group(0) @binding(5) var clipTable: texture_2d<f32>;');
      expect(wgsl).toContain('clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)');
      expect(wgsl).not.toMatch(/\bdiscard\b/);
    },
  );

  it('covers the six canonical scene shaders and their variants', () => {
    // The six with their gradient and move variants; since the SDF shape's image-fill
    // variant and its move variant, since the move variants of the solid-rect and
    // rect-gradient frame backgrounds, since the batched path strokes, since the
    // vector glyph tier's edge hulls and their move variant, and since the scene text's
    // page-count variants (1, 2 and 4 pages).
    expect(SCENE_SHADERS).toHaveLength(26);
  });
});
