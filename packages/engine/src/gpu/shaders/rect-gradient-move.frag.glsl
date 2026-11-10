// Generated from solid-rect.wgsl and clip-shader.ts and gradient-shader.ts and move-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
struct ClipVertex {
    vec4 local;
    vec4 frame;
};
struct VertexInput {
    float moveIndex;
    float paintRow;
    vec2 corner;
    vec2 origin;
    vec2 size;
    vec2 axis;
    vec4 color;
    float clipIndex;
    float layerTransparency;
};
struct VertexOutput {
    vec4 position;
    vec4 clipLocal;
    vec4 clipFrame;
    float layerAlpha;
    vec4 color;
    vec2 unit;
    float paintRow;
};
const uint MAX_CLIP_DEPTH = 8u;

uniform highp sampler2D _group_0_binding_5_fs;

uniform highp sampler2D _group_0_binding_1_fs;

smooth in vec4 _vs2fs_location12;
flat in vec4 _vs2fs_location13;
flat in float _vs2fs_location14;
smooth in vec4 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
flat in float _vs2fs_location2;
layout(location = 0) out vec4 _fs2p_location0;

vec4 clipTexel(uint slot, uint texel) {
    uint index_3 = ((slot * 4u) + texel);
    uint width = uvec2(textureSize(_group_0_binding_5_fs, 0).xy).x;
    vec4 _e15 = texelFetch(_group_0_binding_5_fs, ivec2(int((index_3 % width)), int((index_3 / width))), 0);
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
    vec2 local_1 = vec2(((_e15.z * offset.x) + (_e15.w * offset.y)), ((_e15.z * offset.y) - (_e15.w * offset.x)));
    vec2 parent = (vec2(((_e19.x * local_1.x) - (_e19.y * local_1.y)), ((_e19.y * local_1.x) + (_e19.x * local_1.y))) + _e19.zw);
    result.local = vec4(local_1, parent);
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

float clipCoverage(vec4 local, vec4 frame, float alpha) {
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
        float _e18 = clipRoundedDistance(local.xy, frame.xy, _e17);
        distance_ = _e18;
        vec4 _e20 = clipTexel(own, 1u);
        slot_1 = uint(_e20.z);
    } else {
        float _e25 = clipBoxDistance(local.xy, frame.xy);
        distance_ = _e25;
        slot_1 = uint(frame.z);
    }
    ancestorPoint = local.zw;
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

vec4 paintTexel(uint record, uint texel_1) {
    uint x = (((record % 64u) * 11u) + texel_1);
    vec4 _e14 = texelFetch(_group_0_binding_1_fs, ivec2(int(x), int((record / 64u))), 0);
    return _e14;
}

vec4 paintAt(uint record_1, vec2 unit) {
    float t = 0.0;
    float offsets[8] = float[8](0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    vec4 before = vec4(0.0);
    uint index_1 = 1u;
    vec4 _e3 = paintTexel(record_1, 0u);
    t = (length((unit - _e3.yz)) * _e3.w);
    if ((_e3.x < 0.5)) {
        t = ((0.5 + ((unit.x - 0.5) * _e3.y)) + ((unit.y - 0.5) * _e3.z));
    }
    vec4 _e27 = paintTexel(record_1, 9u);
    vec4 _e29 = paintTexel(record_1, 10u);
    offsets = float[8](_e27.x, _e27.y, _e27.z, _e27.w, _e29.x, _e29.y, _e29.z, _e29.w);
    vec4 _e41 = paintTexel(record_1, 1u);
    before = _e41;
    float _e44 = offsets[0];
    float _e45 = t;
    if ((_e44 > _e45)) {
        vec4 _e47 = before;
        return _e47;
    }
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            uint _e74 = index_1;
            index_1 = (_e74 + 1u);
        }
        loop_init_1 = false;
        uint _e50 = index_1;
        if ((_e50 < 8u)) {
        } else {
            break;
        }
        {
            uint _e54 = index_1;
            vec4 _e56 = paintTexel(record_1, (1u + _e54));
            uint _e57 = index_1;
            float offset_1 = offsets[_e57];
            float _e60 = t;
            if ((offset_1 > _e60)) {
                uint _e62 = index_1;
                float previous = offsets[(_e62 - 1u)];
                vec4 _e67 = before;
                float _e68 = t;
                return mix(_e67, _e56, ((_e68 - previous) / (offset_1 - previous)));
            }
            before = _e56;
        }
    }
    vec4 _e76 = before;
    return _e76;
}

vec4 paintFill(float row, vec4 solid, vec2 unit_1) {
    if ((row < 0.5)) {
        return vec4((solid.xyz * solid.w), solid.w);
    }
    vec4 _e11 = paintAt(uint(row), unit_1);
    return _e11;
}

void main() {
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location12, _vs2fs_location13, _vs2fs_location14, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2);
    vec4 _e4 = paintFill(input_1.paintRow, input_1.color, input_1.unit);
    float _e8 = clipCoverage(input_1.clipLocal, input_1.clipFrame, input_1.layerAlpha);
    _fs2p_location0 = (_e4 * _e8);
    return;
}

