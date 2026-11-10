// Generated from glyph-stencil.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Camera {
    vec2 scale;
    vec2 offset;
    float pixel;
    float padding0_;
    float padding1_;
    float padding2_;
};
struct VertexInput {
    vec2 position;
    vec2 curve;
    vec4 placement;
};
struct VertexOutput {
    vec4 position;
    vec2 curve;
};
layout(std140) uniform Camera_block_0Vertex { Camera _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 3) in vec2 _p2vs_location3;
layout(location = 1) in vec4 _p2vs_location1;
smooth out vec2 _vs2fs_location0;

void main() {
    VertexInput input_ = VertexInput(_p2vs_location0, _p2vs_location3, _p2vs_location1);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec2(0.0));
    vec2 axis = input_.placement.xy;
    vec2 world = (input_.placement.zw + vec2(((axis.x * input_.position.x) - (axis.y * input_.position.y)), ((axis.y * input_.position.x) + (axis.x * input_.position.y))));
    vec2 _e29 = _group_0_binding_0_vs.scale;
    vec2 _e33 = _group_0_binding_0_vs.offset;
    output_.position = vec4(((world * _e29) + _e33), 0.0, 1.0);
    output_.curve = input_.curve;
    VertexOutput _e40 = output_;
    gl_Position = _e40.position;
    _vs2fs_location0 = _e40.curve;
    return;
}

