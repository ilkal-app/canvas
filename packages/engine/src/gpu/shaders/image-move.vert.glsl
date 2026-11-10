// Generated from image.wgsl and clip-shader.ts and move-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
    vec2 corner;
    vec4 placement;
    vec4 quad;
    vec4 uvRect;
    vec4 clampRect;
    vec4 color;
    vec2 weights;
    float clipIndex;
    float layerTransparency;
};
struct VertexOutput {
    vec4 position;
    vec4 clipLocal;
    vec4 clipFrame;
    float layerAlpha;
    vec2 uv;
    vec4 clampRect;
    vec4 color;
    vec2 weights;
};
const uint MAX_CLIP_DEPTH = 8u;

layout(std140) uniform Camera_block_0Vertex { Camera _group_0_binding_0_vs; };

uniform highp sampler2D _group_0_binding_5_vs;

uniform highp sampler2D _group_0_binding_4_vs;

layout(location = 7) in float _p2vs_location7;
layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
layout(location = 3) in vec4 _p2vs_location3;
layout(location = 4) in vec4 _p2vs_location4;
layout(location = 5) in vec4 _p2vs_location5;
layout(location = 6) in vec2 _p2vs_location6;
layout(location = 14) in float _p2vs_location14;
layout(location = 12) in float _p2vs_location12;
smooth out vec4 _vs2fs_location12;
flat out vec4 _vs2fs_location13;
flat out float _vs2fs_location14;
smooth out vec2 _vs2fs_location0;
smooth out vec4 _vs2fs_location1;
smooth out vec4 _vs2fs_location2;
smooth out vec2 _vs2fs_location3;

vec4 clipTexel(uint slot, uint texel) {
    uint index_2 = ((slot * 4u) + texel);
    uint width = uvec2(textureSize(_group_0_binding_5_vs, 0).xy).x;
    vec4 _e15 = texelFetch(_group_0_binding_5_vs, ivec2(int((index_2 % width)), int((index_2 / width))), 0);
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

vec4 movePlacement(float index_1, vec4 fallback) {
    if ((index_1 == 0.0)) {
        return fallback;
    }
    uint width_1 = uvec2(textureSize(_group_0_binding_4_vs, 0).xy).x;
    uint slot_3 = uint(index_1);
    vec4 placed = texelFetch(_group_0_binding_4_vs, ivec2(int((slot_3 % width_1)), int((slot_3 / width_1))), 0);
    vec4 _e21 = texelFetch(_group_0_binding_4_vs, ivec2(0, 0), 0);
    vec2 offset_1 = _e21.xy;
    return vec4((placed.xy + offset_1), placed.zw);
}

void main() {
    VertexInput input_ = VertexInput(_p2vs_location7, _p2vs_location0, _p2vs_location1, _p2vs_location2, _p2vs_location3, _p2vs_location4, _p2vs_location5, _p2vs_location6, _p2vs_location14, _p2vs_location12);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec4(0.0), vec4(0.0), 0.0, vec2(0.0), vec4(0.0), vec4(0.0), vec2(0.0));
    vec4 _e7 = movePlacement(input_.moveIndex, vec4(input_.placement.xy, input_.placement.zw));
    vec2 local_2 = (input_.quad.xy + (input_.corner * input_.quad.zw));
    vec2 axis = _e7.zw;
    vec2 world_1 = (_e7.xy + vec2(((axis.x * local_2.x) - (axis.y * local_2.y)), ((axis.y * local_2.x) + (axis.x * local_2.y))));
    vec2 _e37 = _group_0_binding_0_vs.scale;
    vec2 _e41 = _group_0_binding_0_vs.offset;
    output_.position = vec4(((world_1 * _e37) + _e41), 0.0, 1.0);
    float _e49 = _group_0_binding_0_vs.pixel;
    ClipVertex _e50 = clipVertex(world_1, input_.clipIndex, _e49);
    output_.clipLocal = _e50.local;
    output_.clipFrame = _e50.frame;
    float _e57 = layerAlpha(input_.layerTransparency);
    output_.layerAlpha = _e57;
    output_.uv = mix(input_.uvRect.xy, input_.uvRect.zw, input_.corner);
    output_.clampRect = input_.clampRect;
    output_.color = input_.color;
    output_.weights = input_.weights;
    VertexOutput _e71 = output_;
    gl_Position = _e71.position;
    _vs2fs_location12 = _e71.clipLocal;
    _vs2fs_location13 = _e71.clipFrame;
    _vs2fs_location14 = _e71.layerAlpha;
    _vs2fs_location0 = _e71.uv;
    _vs2fs_location1 = _e71.clampRect;
    _vs2fs_location2 = _e71.color;
    _vs2fs_location3 = _e71.weights;
    return;
}

