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
smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location0);
    if ((((input_1.curve.x * input_1.curve.x) - input_1.curve.y) > 0.0)) {
        discard;
    }
    _fs2p_location0 = vec4(0.0);
    return;
}

