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
layout(std140) uniform Composite_block_0Vertex { Composite _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
smooth out vec2 _vs2fs_location0;

void main() {
    vec2 corner = _p2vs_location0;
    VertexOutput output_ = VertexOutput(vec4(0.0), vec2(0.0));
    vec4 rect = _group_0_binding_0_vs.rect;
    output_.position = vec4(mix(rect.x, rect.z, corner.x), mix(rect.y, rect.w, corner.y), 0.0, 1.0);
    vec2 _e20 = _group_0_binding_0_vs.uvScale;
    output_.corner = (corner * _e20);
    VertexOutput _e22 = output_;
    gl_Position = _e22.position;
    _vs2fs_location0 = _e22.corner;
    return;
}

