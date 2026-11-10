// Generated from parity-triangle.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Frame {
    vec2 viewportSizePx;
    float opacity;
    float padding;
};
struct VertexInput {
    vec2 corner;
    vec4 shade;
    vec2 originPx;
    vec2 sizePx;
    vec4 color;
};
struct VertexOutput {
    vec4 position;
    vec4 color;
    vec2 maskUv;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in vec2 _p2vs_location3;
layout(location = 4) in vec4 _p2vs_location4;
smooth out vec4 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;

void main() {
    VertexInput input_ = VertexInput(_p2vs_location0, _p2vs_location1, _p2vs_location2, _p2vs_location3, _p2vs_location4);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec4(0.0), vec2(0.0));
    vec2 pixel = (input_.originPx + (input_.corner * input_.sizePx));
    float _e10 = _group_0_binding_0_vs.viewportSizePx.x;
    float _e20 = _group_0_binding_0_vs.viewportSizePx.y;
    vec2 clip = vec2((((pixel.x / _e10) * 2.0) - 1.0), (1.0 - ((pixel.y / _e20) * 2.0)));
    output_.position = vec4(clip, 0.0, 1.0);
    output_.color = (input_.color * input_.shade);
    output_.maskUv = input_.corner;
    VertexOutput _e38 = output_;
    gl_Position = _e38.position;
    _vs2fs_location0 = _e38.color;
    _vs2fs_location1 = _e38.maskUv;
    return;
}

