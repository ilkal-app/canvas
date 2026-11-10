import { describe, expect, it } from 'vitest';

import { parseGlslBindings } from './glsl-bindings.js';

/** Declarations as naga 30 writes them for GLSL ES 3.00 (see shaders/parity-triangle.*.glsl). */
const VERTEX_GLSL = `#version 300 es
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };
layout(location = 0) in vec2 _p2vs_location0;`;

const FRAGMENT_GLSL = `#version 300 es
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };
uniform highp sampler2D _group_0_binding_1_fs;
layout(location = 0) out vec4 _fs2p_location0;`;

describe('parseGlslBindings', () => {
  it('maps each stage uniform block to its WGSL binding', () => {
    expect(parseGlslBindings(VERTEX_GLSL)).toEqual([
      { kind: 'uniform-block', name: 'Frame_block_0Vertex', binding: 0 },
    ]);
  });

  it('maps a combined sampler to the binding of the texture it samples', () => {
    expect(parseGlslBindings(FRAGMENT_GLSL)).toEqual([
      { kind: 'uniform-block', name: 'Frame_block_0Fragment', binding: 0 },
      { kind: 'sampler', name: '_group_0_binding_1_fs', binding: 1 },
    ]);
  });

  it('finds nothing in a shader without resources', () => {
    expect(parseGlslBindings('#version 300 es\nvoid main() {}')).toEqual([]);
  });

  it('rejects a resource outside group 0, which the backend does not support', () => {
    const glsl = 'uniform highp sampler2D _group_1_binding_0_fs;';
    expect(() => parseGlslBindings(glsl)).toThrow(RangeError);
  });
});
