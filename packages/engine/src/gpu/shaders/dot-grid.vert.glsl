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
layout(std140) uniform Grid_block_0Vertex { Grid _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
smooth out vec2 _vs2fs_location0;

void main() {
    vec2 corner = _p2vs_location0;
    VertexOutput output_ = VertexOutput(vec4(0.0), vec2(0.0));
    output_.position = vec4(((corner.x * 2.0) - 1.0), (1.0 - (corner.y * 2.0)), 0.0, 1.0);
    vec2 _e19 = _group_0_binding_0_vs.size;
    output_.pixel = (corner * _e19);
    VertexOutput _e21 = output_;
    gl_Position = _e21.position;
    _vs2fs_location0 = _e21.pixel;
    return;
}

