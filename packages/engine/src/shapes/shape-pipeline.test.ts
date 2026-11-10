import { describe, expect, it } from 'vitest';

import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { resolveVertexBufferLayouts } from '../gpu/vertex-layout.js';
import { parseGlslBindings } from '../gpu/webgl2/glsl-bindings.js';

import {
  SHAPE_BINDINGS,
  SHAPE_PIPELINE_DESCRIPTOR,
  SHAPE_QUAD_CORNERS,
  SHAPE_QUAD_VERTEX_COUNT,
} from './shape-pipeline.js';

function occurrences(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

/**
 * Reads the shader's `VertexInput` struct.
 *
 * @param wgsl - The WGSL source.
 * @returns The component count of each `@location`'s type, by location.
 */
function vertexInputWidths(wgsl: string): Map<number, number> {
  const struct = /struct VertexInput \{([^}]*)\}/.exec(wgsl)?.[1] ?? '';
  const widths = new Map<number, number>();
  for (const [, location = '', type = ''] of struct.matchAll(
    /@location\((\d+)\)\s+\w+:\s*(f32|vec[234]f)/g,
  )) {
    widths.set(Number(location), type === 'f32' ? 1 : Number(type.charAt(3)));
  }
  return widths;
}

describe('the SDF shape shader', () => {
  it('has exactly one vertex and one fragment entry point, with the names the build expects', () => {
    const { wgsl, vertexEntryPoint, fragmentEntryPoint } = SDF_SHAPE_SHADER;
    expect(occurrences(wgsl, /@vertex\b/g)).toBe(1);
    expect(occurrences(wgsl, /@fragment\b/g)).toBe(1);
    expect(vertexEntryPoint).toBe('vertexMain');
    expect(fragmentEntryPoint).toBe('fragmentMain');
    expect(occurrences(wgsl, /fn vertexMain\(/g)).toBe(1);
    expect(occurrences(wgsl, /fn fragmentMain\(/g)).toBe(1);
  });

  it('is generated into one GLSL ES 3.0 main per stage', () => {
    for (const glsl of [SDF_SHAPE_SHADER.glslVertex, SDF_SHAPE_SHADER.glslFragment]) {
      expect(glsl.startsWith('#version 300 es')).toBe(true);
      expect(occurrences(glsl, /void main\(\)/g)).toBe(1);
    }
  });

  it('reads the camera uniform in the vertex stage and the clip table in both', () => {
    expect(parseGlslBindings(SDF_SHAPE_SHADER.glslVertex)).toEqual([
      { kind: 'uniform-block', name: 'Camera_block_0Vertex', binding: 0 },
      { kind: 'sampler', name: '_group_0_binding_5_vs', binding: 5 },
    ]);
    expect(parseGlslBindings(SDF_SHAPE_SHADER.glslFragment)).toEqual([
      { kind: 'sampler', name: '_group_0_binding_5_fs', binding: 5 },
    ]);
  });

  it('takes an input of the same width as every attribute of the vertex layout', () => {
    const widths = vertexInputWidths(SDF_SHAPE_SHADER.wgsl);
    const attributes = resolveVertexBufferLayouts(SHAPE_PIPELINE_DESCRIPTOR.vertexBuffers).flatMap(
      (layout) => layout.attributes,
    );
    expect(widths.size).toBe(attributes.length);
    for (const { location, componentCount } of attributes) {
      expect(widths.get(location), `@location(${String(location)})`).toBe(componentCount);
    }
  });
});

describe('SHAPE_PIPELINE_DESCRIPTOR', () => {
  it('blends premultiplied output and binds the camera uniform and the clip table', () => {
    expect(SHAPE_PIPELINE_DESCRIPTOR.shader).toBe(SDF_SHAPE_SHADER);
    expect(SHAPE_PIPELINE_DESCRIPTOR.blend).toBe('premultiplied');
    expect(SHAPE_PIPELINE_DESCRIPTOR.bindings).toBe(SHAPE_BINDINGS);
    expect(SHAPE_BINDINGS).toEqual([
      { binding: 0, kind: 'uniform-buffer' },
      { binding: 5, kind: 'load-texture' },
    ]);
    expect(SHAPE_PIPELINE_DESCRIPTOR.stencil).toBeUndefined();
  });
});

describe('SHAPE_QUAD_CORNERS', () => {
  it('is two triangles that together cover the unit square', () => {
    expect(SHAPE_QUAD_CORNERS).toHaveLength(SHAPE_QUAD_VERTEX_COUNT * 2);
    expect(SHAPE_QUAD_VERTEX_COUNT).toBe(6);
    const corners = new Set<string>();
    let doubledArea = 0;
    for (let triangle = 0; triangle < 2; triangle += 1) {
      const at = (vertex: number, axis: number): number =>
        SHAPE_QUAD_CORNERS[(triangle * 3 + vertex) * 2 + axis] ?? Number.NaN;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        corners.add(`${String(at(vertex, 0))},${String(at(vertex, 1))}`);
      }
      doubledArea += Math.abs(
        (at(1, 0) - at(0, 0)) * (at(2, 1) - at(0, 1)) -
          (at(2, 0) - at(0, 0)) * (at(1, 1) - at(0, 1)),
      );
    }
    expect([...corners].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(doubledArea / 2).toBe(1);
  });
});

describe('SHAPE_QUAD_CORNERS immutability', () => {
  it('cannot be changed by a consumer, so every renderer uploads the same quad', () => {
    expect(Object.isFrozen(SHAPE_QUAD_CORNERS)).toBe(true);
    expect(() => {
      (SHAPE_QUAD_CORNERS as number[])[0] = 5;
    }).toThrow(TypeError);
  });
});
