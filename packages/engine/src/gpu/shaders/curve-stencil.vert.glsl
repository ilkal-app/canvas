// Generated from curve-stencil.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Frame {
    vec2 viewportSizePx;
    vec2 padding;
};
struct VertexInput {
    vec2 positionPx;
    vec2 curve;
};
struct VertexOutput {
    vec4 position;
    vec2 curve;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
smooth out vec2 _vs2fs_location0;

void main() {
    VertexInput input_ = VertexInput(_p2vs_location0, _p2vs_location1);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec2(0.0));
    float _e6 = _group_0_binding_0_vs.viewportSizePx.x;
    float _e17 = _group_0_binding_0_vs.viewportSizePx.y;
    vec2 clip = vec2((((input_.positionPx.x / _e6) * 2.0) - 1.0), (1.0 - ((input_.positionPx.y / _e17) * 2.0)));
    output_.position = vec4(clip, 0.0, 1.0);
    output_.curve = input_.curve;
    VertexOutput _e31 = output_;
    gl_Position = _e31.position;
    _vs2fs_location0 = _e31.curve;
    return;
}

