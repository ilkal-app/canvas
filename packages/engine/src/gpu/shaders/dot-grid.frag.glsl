// Generated from dot-grid.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Grid {
    vec2 phase;
    vec2 size;
    vec4 color;
    float spacing;
    float radius;
    vec2 padding;
};
struct VertexOutput {
    vec4 position;
    vec2 pixel;
};
layout(std140) uniform Grid_block_0Fragment { Grid _group_0_binding_0_fs; };

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VertexOutput input_ = VertexOutput(gl_FragCoord, _vs2fs_location0);
    vec2 _e4 = _group_0_binding_0_fs.phase;
    vec2 fromPhase = (input_.pixel - _e4);
    float _e8 = _group_0_binding_0_fs.spacing;
    float _e11 = _group_0_binding_0_fs.spacing;
    vec2 offset = (fromPhase - (_e8 * roundEven((fromPhase / vec2(_e11)))));
    float _e19 = _group_0_binding_0_fs.radius;
    float coverage = clamp(((_e19 + 0.5) - length(offset)), 0.0, 1.0);
    float _e30 = _group_0_binding_0_fs.color.w;
    float alpha = (_e30 * coverage);
    vec4 _e34 = _group_0_binding_0_fs.color;
    _fs2p_location0 = vec4((_e34.xyz * alpha), alpha);
    return;
}

