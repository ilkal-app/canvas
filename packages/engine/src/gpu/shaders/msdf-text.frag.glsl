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
layout(std140) uniform AtlasPage_block_0Fragment { AtlasPage _group_0_binding_1_fs; };

uniform highp sampler2D _group_0_binding_2_fs;

smooth in vec2 _vs2fs_location0;
flat in vec2 _vs2fs_location2;
smooth in vec4 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

float median3_(vec3 sample_) {
    return max(min(sample_.x, sample_.y), min(max(sample_.x, sample_.y), sample_.z));
}

vec4 sampleAtlas(vec2 uv) {
    vec2 _e3 = _group_0_binding_1_fs.sizeTexels;
    vec2 position = ((uv * _e3) - vec2(0.5));
    ivec2 base = ivec2(floor(position));
    vec2 fraction = fract(position);
    vec2 _e13 = _group_0_binding_1_fs.sizeTexels;
    ivec2 last = (ivec2(_e13) - ivec2(1));
    vec4 a = texelFetch(_group_0_binding_2_fs, min(max(base, ivec2(0)), last), 0);
    vec4 b = texelFetch(_group_0_binding_2_fs, min(max((base + ivec2(1, 0)), ivec2(0)), last), 0);
    vec4 c = texelFetch(_group_0_binding_2_fs, min(max((base + ivec2(0, 1)), ivec2(0)), last), 0);
    vec4 d = texelFetch(_group_0_binding_2_fs, min(max((base + ivec2(1, 1)), ivec2(0)), last), 0);
    return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

void main() {
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location0, _vs2fs_location2, _vs2fs_location1);
    vec4 _e4 = sampleAtlas((input_1.atlasOrigin + input_1.uv));
    float _e6 = median3_(_e4.xyz);
    float _e10 = _group_0_binding_1_fs.isSingleChannel;
    float field = ((abs((_e10 - 1.0)) < 0.5) ? _e4.x : _e6);
    float _e19 = _group_0_binding_1_fs.distanceRangeTexels;
    vec2 _e23 = _group_0_binding_1_fs.sizeTexels;
    vec2 unitRange = (vec2(_e19) / _e23);
    vec2 _e28 = fwidth(input_1.uv);
    vec2 screenTexelSize = (vec2(1.0) / _e28);
    float screenPxRange = max((0.5 * dot(unitRange, screenTexelSize)), 1.0);
    float coverage = clamp(((screenPxRange * (field - 0.5)) + 0.5), 0.0, 1.0);
    float alpha = (input_1.color.w * coverage);
    _fs2p_location0 = vec4((input_1.color.xyz * alpha), alpha);
    return;
}

