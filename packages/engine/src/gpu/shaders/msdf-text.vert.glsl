// Generated from msdf-text.wgsl by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
#version 300 es

precision highp float;
precision highp int;

struct Camera {
    vec2 scale;
    vec2 offset;
};
struct AtlasPage {
    vec2 sizeTexels;
    float distanceRangeTexels;
    float isSingleChannel;
};
struct VertexInput {
    vec2 corner;
    vec4 rect;
    vec4 uvRect;
    vec4 color;
};
struct VertexOutput {
    vec4 position;
    vec2 uv;
    vec2 atlasOrigin;
    vec4 color;
};
layout(std140) uniform Camera_block_0Vertex { Camera _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
layout(location = 3) in vec4 _p2vs_location3;
smooth out vec2 _vs2fs_location0;
flat out vec2 _vs2fs_location2;
smooth out vec4 _vs2fs_location1;

float median3_(vec3 sample_) {
    return max(min(sample_.x, sample_.y), min(max(sample_.x, sample_.y), sample_.z));
}

void main() {
    VertexInput input_ = VertexInput(_p2vs_location0, _p2vs_location1, _p2vs_location2, _p2vs_location3);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec2(0.0), vec2(0.0), vec4(0.0));
    vec2 world = (input_.rect.xy + (input_.corner * input_.rect.zw));
    vec2 _e12 = _group_0_binding_0_vs.scale;
    vec2 _e16 = _group_0_binding_0_vs.offset;
    output_.position = vec4(((world * _e12) + _e16), 0.0, 1.0);
    output_.uv = ((input_.uvRect.zw - input_.uvRect.xy) * input_.corner);
    output_.atlasOrigin = input_.uvRect.xy;
    output_.color = input_.color;
    VertexOutput _e34 = output_;
    gl_Position = _e34.position;
    _vs2fs_location0 = _e34.uv;
    _vs2fs_location2 = _e34.atlasOrigin;
    _vs2fs_location1 = _e34.color;
    return;
}

