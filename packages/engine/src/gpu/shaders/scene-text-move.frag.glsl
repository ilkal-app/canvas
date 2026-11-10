// Generated from scene-text.wgsl and clip-shader.ts and move-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
struct AtlasPage {
    vec2 sizeTexels;
    float distanceRangeTexels;
    float mode;
};
struct AtlasPages {
    AtlasPage pages[8];
};
struct ClipVertex {
    vec4 local;
    vec4 frame;
};
struct VertexInput {
    float moveIndex;
    vec2 corner;
    vec2 origin;
    vec2 axis;
    vec4 rect;
    vec4 uvRect;
    vec4 color;
    float pageIndex;
    float clipIndex;
    float layerTransparency;
};
struct VertexOutput {
    vec4 position;
    vec4 clipLocal;
    vec4 clipFrame;
    float layerAlpha;
    vec2 uv;
    vec2 atlasOrigin;
    vec4 color;
    vec2 bar;
    uint pageIndex;
};
const float STEM_DARKEN_PX = 0.15;
const float DARKEN_FADE_EM_PX = 12.0;
const float DARKEN_END_EM_PX = 24.0;
const float SMALL_TIER_EM_TEXELS = 64.0;
const uint MAX_CLIP_DEPTH = 8u;

layout(std140) uniform AtlasPages_block_0Fragment { AtlasPages _group_0_binding_1_fs; };

uniform highp sampler2D _group_0_binding_2_fs;

uniform highp sampler2D _group_0_binding_6_fs;

uniform highp sampler2D _group_0_binding_7_fs;

uniform highp sampler2D _group_0_binding_8_fs;

uniform highp sampler2D _group_0_binding_9_fs;

uniform highp sampler2D _group_0_binding_10_fs;

uniform highp sampler2D _group_0_binding_11_fs;

uniform highp sampler2D _group_0_binding_12_fs;

uniform highp sampler2D _group_0_binding_5_fs;

smooth in vec4 _vs2fs_location12;
flat in vec4 _vs2fs_location13;
flat in float _vs2fs_location14;
smooth in vec2 _vs2fs_location0;
flat in vec2 _vs2fs_location3;
smooth in vec4 _vs2fs_location1;
smooth in vec2 _vs2fs_location2;
flat in uint _vs2fs_location4;
layout(location = 0) out vec4 _fs2p_location0;

vec4 clipTexel(uint slot, uint texel) {
    uint index_4 = ((slot * 4u) + texel);
    uint width = uvec2(textureSize(_group_0_binding_5_fs, 0).xy).x;
    vec4 _e15 = texelFetch(_group_0_binding_5_fs, ivec2(int((index_4 % width)), int((index_4 / width))), 0);
    return _e15;
}

ClipVertex clipVertex(vec2 world, float index, float pixel) {
    ClipVertex result = ClipVertex(vec4(0.0), vec4(0.0));
    result.local = vec4(0.0);
    result.frame = vec4(0.0);
    if ((index < 0.5)) {
        ClipVertex _e12 = result;
        return _e12;
    }
    uint slot_2 = uint(index);
    vec4 _e15 = clipTexel(slot_2, 0u);
    vec4 _e17 = clipTexel(slot_2, 1u);
    vec4 _e19 = clipTexel(slot_2, 2u);
    vec2 offset = (world - _e15.xy);
    vec2 local_2 = vec2(((_e15.z * offset.x) + (_e15.w * offset.y)), ((_e15.z * offset.y) - (_e15.w * offset.x)));
    vec2 parent = (vec2(((_e19.x * local_2.x) - (_e19.y * local_2.y)), ((_e19.y * local_2.x) + (_e19.x * local_2.y))) + _e19.zw);
    result.local = vec4(local_2, parent);
    result.frame = vec4(_e17.xy, ((_e17.w > 0.5) ? -(float(slot_2)) : _e17.z), max(pixel, 1e-30));
    ClipVertex _e68 = result;
    return _e68;
}

float clipBoxDistance(vec2 p, vec2 size) {
    vec2 outside = max(-(p), (p - size));
    return max(outside.x, outside.y);
}

float clipRoundedDistance(vec2 p_1, vec2 size_1, vec4 radii) {
    vec2 half_ = (size_1 * 0.5);
    vec2 q = (p_1 - half_);
    float left = ((q.y < 0.0) ? radii.x : radii.w);
    float right = ((q.y < 0.0) ? radii.y : radii.z);
    float radius = ((q.x < 0.0) ? left : right);
    vec2 d = ((abs(q) - half_) + vec2(radius));
    return ((min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)))) - radius);
}

float layerAlpha(float transparency) {
    return clamp((1.0 - transparency), 0.0, 1.0);
}

float clipCoverage(vec4 local_1, vec4 frame, float alpha) {
    float distance_ = 0.0;
    uint slot_1 = 0u;
    vec2 ancestorPoint = vec2(0.0);
    uint level = 1u;
    float levelDistance = 0.0;
    if ((frame.w <= 0.0)) {
        return alpha;
    }
    if ((frame.z < 0.0)) {
        uint own = uint(-(frame.z));
        vec4 _e17 = clipTexel(own, 3u);
        float _e18 = clipRoundedDistance(local_1.xy, frame.xy, _e17);
        distance_ = _e18;
        vec4 _e20 = clipTexel(own, 1u);
        slot_1 = uint(_e20.z);
    } else {
        float _e25 = clipBoxDistance(local_1.xy, frame.xy);
        distance_ = _e25;
        slot_1 = uint(frame.z);
    }
    ancestorPoint = local_1.zw;
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            uint _e86 = level;
            level = (_e86 + 1u);
        }
        loop_init = false;
        uint _e32 = level;
        if ((_e32 < MAX_CLIP_DEPTH)) {
        } else {
            break;
        }
        {
            uint _e35 = slot_1;
            if ((_e35 == 0u)) {
                break;
            }
            uint _e38 = slot_1;
            vec4 _e40 = clipTexel(_e38, 1u);
            vec2 _e41 = ancestorPoint;
            float _e43 = clipBoxDistance(_e41, _e40.xy);
            levelDistance = _e43;
            if ((_e40.w > 0.5)) {
                vec2 _e48 = ancestorPoint;
                uint _e50 = slot_1;
                vec4 _e52 = clipTexel(_e50, 3u);
                float _e53 = clipRoundedDistance(_e48, _e40.xy, _e52);
                levelDistance = _e53;
            }
            float _e54 = distance_;
            float _e55 = levelDistance;
            distance_ = max(_e54, _e55);
            uint next = uint(_e40.z);
            if ((next != 0u)) {
                uint _e61 = slot_1;
                vec4 _e63 = clipTexel(_e61, 2u);
                float _e66 = ancestorPoint.x;
                float _e70 = ancestorPoint.y;
                float _e75 = ancestorPoint.x;
                float _e79 = ancestorPoint.y;
                ancestorPoint = (vec2(((_e63.x * _e66) - (_e63.y * _e70)), ((_e63.y * _e75) + (_e63.x * _e79))) + _e63.zw);
            }
            slot_1 = next;
        }
    }
    float _e88 = distance_;
    return (clamp((0.5 - (_e88 / frame.w)), 0.0, 1.0) * alpha);
}

float toLinear(float value) {
    return ((value <= 0.04045) ? (value / 12.92) : pow(((value + 0.055) / 1.055), 2.4));
}

float toEncoded(float value_1) {
    return ((value_1 <= 0.0031308) ? (value_1 * 12.92) : ((1.055 * pow(value_1, 0.41666666)) - 0.055));
}

float gammaCorrectedCoverage(float coverage, vec3 color) {
    float _e3 = toLinear(color.x);
    float _e5 = toLinear(color.y);
    float _e7 = toLinear(color.z);
    float luminance = dot(vec3(_e3, _e5, _e7), vec3(0.2126, 0.7152, 0.0722));
    float _e14 = toEncoded(luminance);
    float _e20 = toEncoded((1.0 - (coverage * (1.0 - luminance))));
    float onWhite = ((1.0 - _e20) / max((1.0 - _e14), 0.0001));
    float _e29 = toEncoded((coverage * luminance));
    float onBlack = (_e29 / max(_e14, 0.0001));
    return clamp(((_e14 < 0.5) ? onWhite : onBlack), 0.0, 1.0);
}

float median3_(vec3 sample_) {
    return max(min(sample_.x, sample_.y), min(max(sample_.x, sample_.y), sample_.z));
}

vec4 loadTexel(uint index_2, ivec2 texel_1) {
    switch(index_2) {
        case 1u: {
            vec4 _e4 = texelFetch(_group_0_binding_6_fs, texel_1, 0);
            return _e4;
        }
        case 2u: {
            vec4 _e7 = texelFetch(_group_0_binding_7_fs, texel_1, 0);
            return _e7;
        }
        case 3u: {
            vec4 _e10 = texelFetch(_group_0_binding_8_fs, texel_1, 0);
            return _e10;
        }
        case 4u: {
            vec4 _e13 = texelFetch(_group_0_binding_9_fs, texel_1, 0);
            return _e13;
        }
        case 5u: {
            vec4 _e16 = texelFetch(_group_0_binding_10_fs, texel_1, 0);
            return _e16;
        }
        case 6u: {
            vec4 _e19 = texelFetch(_group_0_binding_11_fs, texel_1, 0);
            return _e19;
        }
        case 7u: {
            vec4 _e22 = texelFetch(_group_0_binding_12_fs, texel_1, 0);
            return _e22;
        }
        default: {
            vec4 _e25 = texelFetch(_group_0_binding_2_fs, texel_1, 0);
            return _e25;
        }
    }
}

vec4 sampleAtlas(vec2 uv, uint index_3, AtlasPage page) {
    vec2 position = ((uv * page.sizeTexels) - vec2(0.5));
    ivec2 base = ivec2(floor(position));
    vec2 fraction = fract(position);
    ivec2 last = (ivec2(page.sizeTexels) - ivec2(1));
    vec4 _e19 = loadTexel(index_3, min(max(base, ivec2(0)), last));
    vec4 _e27 = loadTexel(index_3, min(max((base + ivec2(1, 0)), ivec2(0)), last));
    vec4 _e35 = loadTexel(index_3, min(max((base + ivec2(0, 1)), ivec2(0)), last));
    vec4 _e43 = loadTexel(index_3, min(max((base + ivec2(1, 1)), ivec2(0)), last));
    return mix(mix(_e19, _e27, fraction.x), mix(_e35, _e43, fraction.x), fraction.y);
}

void main() {
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location12, _vs2fs_location13, _vs2fs_location14, _vs2fs_location0, _vs2fs_location3, _vs2fs_location1, _vs2fs_location2, _vs2fs_location4);
    bool local = false;
    AtlasPage page_1 = _group_0_binding_1_fs.pages[input_1.pageIndex];
    vec4 _e10 = sampleAtlas((input_1.atlasOrigin + input_1.uv), input_1.pageIndex, page_1);
    float _e12 = median3_(_e10.xyz);
    float field = ((abs((page_1.mode - 1.0)) < 0.5) ? _e10.x : _e12);
    vec2 unitRange = (vec2(page_1.distanceRangeTexels) / page_1.sizeTexels);
    vec2 _e28 = fwidth(input_1.uv);
    vec2 screenTexelSize = (vec2(1.0) / _e28);
    float screenPxRange = max((0.5 * dot(unitRange, screenTexelSize)), 1.0);
    float emPx = ((SMALL_TIER_EM_TEXELS * screenPxRange) / page_1.distanceRangeTexels);
    float darkenPx = (STEM_DARKEN_PX * clamp(((DARKEN_END_EM_PX - emPx) / DARKEN_FADE_EM_PX), 0.0, 1.0));
    float glyphCoverage = clamp((((screenPxRange * (field - 0.5)) + 0.5) + darkenPx), 0.0, 1.0);
    float barCoverage = clamp((min((input_1.bar.x + 0.5), input_1.bar.y) - max((input_1.bar.x - 0.5), 0.0)), 0.0, 1.0);
    float coverage_1 = ((input_1.atlasOrigin.x < 0.0) ? barCoverage : glyphCoverage);
    float _e81 = gammaCorrectedCoverage(coverage_1, input_1.color.xyz);
    float alpha_1 = (input_1.color.w * _e81);
    if ((page_1.mode > 1.5)) {
        local = (input_1.atlasOrigin.x >= 0.0);
    } else {
        local = false;
    }
    bool isColour = local;
    vec4 painted = (isColour ? (_e10 * input_1.color.w) : vec4((input_1.color.xyz * alpha_1), alpha_1));
    float _e107 = clipCoverage(input_1.clipLocal, input_1.clipFrame, input_1.layerAlpha);
    _fs2p_location0 = (painted * _e107);
    return;
}

