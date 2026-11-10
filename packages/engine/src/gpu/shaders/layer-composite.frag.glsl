// Generated from layer-composite.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Composite {
    float opacity;
    float flipRows;
    vec2 uvScale;
    vec4 rect;
};
struct VertexOutput {
    vec4 position;
    vec2 corner;
};
layout(std140) uniform Composite_block_0Fragment { Composite _group_0_binding_0_fs; };

uniform highp sampler2D _group_0_binding_1_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VertexOutput input_ = VertexOutput(gl_FragCoord, _vs2fs_location0);
    float _e9 = _group_0_binding_0_fs.flipRows;
    float v = mix(input_.corner.y, (1.0 - input_.corner.y), _e9);
    vec4 color = texture(_group_0_binding_1_fs, vec2(vec2(input_.corner.x, v)));
    float _e19 = _group_0_binding_0_fs.opacity;
    _fs2p_location0 = (color * _e19);
    return;
}

