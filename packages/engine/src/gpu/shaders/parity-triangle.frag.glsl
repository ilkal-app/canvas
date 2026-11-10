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
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

uniform highp sampler2D _group_0_binding_1_fs;

smooth in vec4 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 _e4 = texture(_group_0_binding_1_fs, vec2(input_1.maskUv));
    float mask = _e4.x;
    float _e10 = _group_0_binding_0_fs.opacity;
    float alpha = ((input_1.color.w * _e10) * mask);
    _fs2p_location0 = vec4((input_1.color.xyz * alpha), alpha);
    return;
}

