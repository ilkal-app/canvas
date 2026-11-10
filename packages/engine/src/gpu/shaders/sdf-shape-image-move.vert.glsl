// Generated from sdf-shape.wgsl and clip-shader.ts and image-fill-shader.ts and move-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
    vec4 uvRect;
    vec4 clampRect;
    vec4 imageFit;
    vec2 imageWeights;
    vec2 corner;
    vec4 rect;
    vec4 color;
    vec3 shape;
    vec2 axis;
    vec4 strokeColor;
    vec3 outline;
    vec4 corners;
    float clipIndex;
    float layerTransparency;
};
struct VertexOutput {
    vec4 position;
    vec4 clipLocal;
    vec4 clipFrame;
    float layerAlpha;
    vec2 local;
    vec2 halfSize;
    vec4 color;
    vec3 shape;
    vec4 strokeColor;
    vec3 outline;
    vec4 fit;
    float pixel;
    vec2 imageT;
    vec4 uvRect;
    vec4 clampRect;
    vec4 imageWeights;
};
const uint MAX_CLIP_DEPTH = 8u;

layout(std140) uniform Camera_block_0Vertex { Camera _group_0_binding_0_vs; };

uniform highp sampler2D _group_0_binding_5_vs;

uniform highp sampler2D _group_0_binding_4_vs;

layout(location = 7) in float _p2vs_location7;
layout(location = 8) in vec4 _p2vs_location8;
layout(location = 9) in vec4 _p2vs_location9;
layout(location = 10) in vec4 _p2vs_location10;
layout(location = 11) in vec2 _p2vs_location11;
layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
layout(location = 3) in vec3 _p2vs_location3;
layout(location = 4) in vec2 _p2vs_location4;
layout(location = 5) in vec4 _p2vs_location5;
layout(location = 6) in vec3 _p2vs_location6;
layout(location = 15) in vec4 _p2vs_location15;
layout(location = 14) in float _p2vs_location14;
layout(location = 12) in float _p2vs_location12;
smooth out vec4 _vs2fs_location12;
flat out vec4 _vs2fs_location13;
flat out float _vs2fs_location14;
smooth out vec2 _vs2fs_location0;
flat out vec2 _vs2fs_location1;
flat out vec4 _vs2fs_location2;
flat out vec3 _vs2fs_location3;
flat out vec4 _vs2fs_location4;
flat out vec3 _vs2fs_location5;
flat out vec4 _vs2fs_location6;
flat out float _vs2fs_location7;
smooth out vec2 _vs2fs_location8;
flat out vec4 _vs2fs_location9;
flat out vec4 _vs2fs_location10;
flat out vec4 _vs2fs_location11;

vec4 clipTexel(uint slot, uint texel) {
    uint index_6 = ((slot * 4u) + texel);
    uint width = uvec2(textureSize(_group_0_binding_5_vs, 0).xy).x;
    vec4 _e15 = texelFetch(_group_0_binding_5_vs, ivec2(int((index_6 % width)), int((index_6 / width))), 0);
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
    vec2 offset_1 = (world - _e15.xy);
    vec2 local_6 = vec2(((_e15.z * offset_1.x) + (_e15.w * offset_1.y)), ((_e15.z * offset_1.y) - (_e15.w * offset_1.x)));
    vec2 parent = (vec2(((_e19.x * local_6.x) - (_e19.y * local_6.y)), ((_e19.y * local_6.x) + (_e19.x * local_6.y))) + _e19.zw);
    result.local = vec4(local_6, parent);
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
    float radius_3 = ((q.x < 0.0) ? left : right);
    vec2 d = ((abs(q) - half_) + vec2(radius_3));
    return ((min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)))) - radius_3);
}

float layerAlpha(float transparency) {
    return clamp((1.0 - transparency), 0.0, 1.0);
}

float clipCoverage(vec4 local_2, vec4 frame, float alpha) {
    float distance_1 = 0.0;
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
        float _e18 = clipRoundedDistance(local_2.xy, frame.xy, _e17);
        distance_1 = _e18;
        vec4 _e20 = clipTexel(own, 1u);
        slot_1 = uint(_e20.z);
    } else {
        float _e25 = clipBoxDistance(local_2.xy, frame.xy);
        distance_1 = _e25;
        slot_1 = uint(frame.z);
    }
    ancestorPoint = local_2.zw;
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
            float _e54 = distance_1;
            float _e55 = levelDistance;
            distance_1 = max(_e54, _e55);
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
    float _e88 = distance_1;
    return (clamp((0.5 - (_e88 / frame.w)), 0.0, 1.0) * alpha);
}

vec2 cropTap(vec2 index_1, vec2 count, vec2 start, vec2 span, vec2 dims, vec2 low, vec2 high) {
    vec2 wrapped = (index_1 - (count * floor((index_1 / count))));
    return clamp(((start + (((wrapped + vec2(0.5)) * span) / count)) / dims), low, high);
}

vec4 movePlacement(float index_2, vec4 fallback) {
    if ((index_2 == 0.0)) {
        return fallback;
    }
    uint width_1 = uvec2(textureSize(_group_0_binding_4_vs, 0).xy).x;
    uint slot_3 = uint(index_2);
    vec4 placed = texelFetch(_group_0_binding_4_vs, ivec2(int((slot_3 % width_1)), int((slot_3 / width_1))), 0);
    vec4 _e21 = texelFetch(_group_0_binding_4_vs, ivec2(0, 0), 0);
    vec2 offset_2 = _e21.xy;
    return vec4((placed.xy + offset_2), placed.zw);
}

float polygonSides(float kind, float sides) {
    return ((kind < 2.5) ? 4.0 : clamp(roundEven(sides), 3.0, 64.0));
}

bool isStarKind(float kind_1) {
    return (kind_1 > 3.5);
}

vec2 unitPolygonVertex(float index_3, float sides_1, bool isStar) {
    bool local_4 = false;
    float step_ = (isStar ? (3.1415927 / sides_1) : (6.2831855 / sides_1));
    float angle = (index_3 * step_);
    if (isStar) {
        local_4 = ((index_3 - (2.0 * floor((index_3 * 0.5)))) > 0.5);
    } else {
        local_4 = false;
    }
    bool isInner = local_4;
    float radius_4 = (isInner ? (0.5 * cos((3.1415927 / sides_1))) : 1.0);
    return vec2((radius_4 * sin(angle)), (-(radius_4) * cos(angle)));
}

vec4 polygonFit(vec2 halfSize_1, float sides_2, bool isStar_1) {
    vec2 low_1 = vec2(1000000000.0);
    vec2 high_1 = vec2(-1000000000.0);
    int index_4 = 0;
    int count_2 = int((isStar_1 ? (2.0 * sides_2) : sides_2));
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e25 = index_4;
            index_4 = (_e25 + 1);
        }
        loop_init_1 = false;
        int _e15 = index_4;
        if ((_e15 < count_2)) {
        } else {
            break;
        }
        {
            int _e17 = index_4;
            vec2 _e19 = unitPolygonVertex(float(_e17), sides_2, isStar_1);
            vec2 _e20 = low_1;
            low_1 = min(_e20, _e19);
            vec2 _e22 = high_1;
            high_1 = max(_e22, _e19);
        }
    }
    vec2 _e27 = low_1;
    vec2 _e28 = high_1;
    vec2 _e34 = high_1;
    vec2 _e35 = low_1;
    return vec4(((_e27 + _e28) * 0.5), ((2.0 * halfSize_1) / max((_e34 - _e35), vec2(1e-6))));
}

float cornerRadiusAt(vec2 p_2, vec4 corners) {
    float left_1 = ((p_2.y < 0.0) ? corners.x : corners.w);
    float right_1 = ((p_2.y < 0.0) ? corners.y : corners.z);
    return ((p_2.x < 0.0) ? left_1 : right_1);
}

float roundedBoxDistance(vec2 p_3, vec2 halfSize_2, float radius_1) {
    vec2 q_1 = ((abs(p_3) - halfSize_2) + vec2(radius_1));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - radius_1);
}

float ellipseDistance(vec2 p_4, vec2 radii_1) {
    float k0_ = length((p_4 / radii_1));
    float k1_ = length((p_4 / (radii_1 * radii_1)));
    return ((k1_ < 1e-6) ? -(min(radii_1.x, radii_1.y)) : ((k0_ * (k0_ - 1.0)) / k1_));
}

float outlineOuterDistance(vec2 p_5, vec2 halfSize_3, float radius_2, float kind_2, float distance_2, float outward) {
    if ((kind_2 < 0.5)) {
        float _e15 = roundedBoxDistance(p_5, (halfSize_3 + vec2(outward)), ((radius_2 > 0.0) ? (radius_2 + outward) : 0.0));
        return _e15;
    }
    return (distance_2 - outward);
}

float segmentDistanceSquared(vec2 p_6, vec2 start_1, vec2 end) {
    vec2 edge = (end - start_1);
    float along = clamp((dot((p_6 - start_1), edge) / max(dot(edge, edge), 1e-12)), 0.0, 1.0);
    vec2 gap = ((p_6 - start_1) - (edge * along));
    return dot(gap, gap);
}

vec2 placedPolygonVertex(float index_5, float count_1, vec4 fit, float sides_3, bool isStar_2) {
    float wrapped_1 = (index_5 - (count_1 * floor((index_5 / count_1))));
    vec2 _e9 = unitPolygonVertex(wrapped_1, sides_3, isStar_2);
    return ((_e9 - fit.xy) * fit.zw);
}

float unitPolygonInradius(float sides_4, bool isStar_3) {
    vec2 _e3 = unitPolygonVertex(0.0, sides_4, isStar_3);
    vec2 _e5 = unitPolygonVertex(1.0, sides_4, isStar_3);
    float _e8 = segmentDistanceSquared(vec2(0.0), _e3, _e5);
    return sqrt(_e8);
}

float polygonDistance(vec2 p_7, vec4 fit_1, float sides_5, bool isStar_4, float band) {
    bool local_5 = false;
    float squared = 0.0;
    float offset = 1.0;
    float count_3 = (isStar_4 ? (2.0 * sides_5) : sides_5);
    float step_1 = (isStar_4 ? (3.1415927 / sides_5) : (6.2831855 / sides_5));
    vec2 unit = ((p_7 / fit_1.zw) + fit_1.xy);
    float turned = atan(unit.x, -(unit.y));
    float angle_1 = ((turned < 0.0) ? (turned + 6.2831855) : turned);
    float sector = min(floor((angle_1 / step_1)), (count_3 - 1.0));
    vec2 _e31 = placedPolygonVertex(sector, count_3, fit_1, sides_5, isStar_4);
    vec2 _e34 = placedPolygonVertex((sector + 1.0), count_3, fit_1, sides_5, isStar_4);
    vec2 centre = (-(fit_1.xy) * fit_1.zw);
    vec2 edge_1 = (_e34 - _e31);
    float pointSide = ((edge_1.x * (p_7.y - _e31.y)) - (edge_1.y * (p_7.x - _e31.x)));
    float centreSide = ((edge_1.x * (centre.y - _e31.y)) - (edge_1.y * (centre.x - _e31.x)));
    bool isInside = ((pointSide * centreSide) >= 0.0);
    float smallerScale = min(fit_1.z, fit_1.w);
    float radius_5 = length(unit);
    float _e69 = unitPolygonInradius(sides_5, isStar_4);
    float depth = ((_e69 - radius_5) * smallerScale);
    if (isInside) {
        local_5 = (depth >= band);
    } else {
        local_5 = false;
    }
    bool _e76 = local_5;
    if (_e76) {
        return -(depth);
    }
    float near = (radius_5 * smallerScale);
    float spread = ((band < near) ? asin((band / near)) : 3.1415927);
    float reach = min(floor((count_3 * 0.5)), (ceil((spread / step_1)) + 1.0));
    float _e92 = segmentDistanceSquared(p_7, _e31, _e34);
    squared = _e92;
    bool loop_init_2 = true;
    while(true) {
        if (!loop_init_2) {
            float _e120 = offset;
            offset = (_e120 + 1.0);
        }
        loop_init_2 = false;
        float _e96 = offset;
        if ((_e96 <= reach)) {
        } else {
            break;
        }
        {
            float _e98 = offset;
            vec2 _e100 = placedPolygonVertex((sector - _e98), count_3, fit_1, sides_5, isStar_4);
            float _e101 = offset;
            vec2 _e103 = placedPolygonVertex((sector + _e101), count_3, fit_1, sides_5, isStar_4);
            float _e104 = offset;
            vec2 _e108 = placedPolygonVertex(((sector - _e104) + 1.0), count_3, fit_1, sides_5, isStar_4);
            float _e109 = offset;
            vec2 _e113 = placedPolygonVertex(((sector + _e109) + 1.0), count_3, fit_1, sides_5, isStar_4);
            float _e114 = squared;
            float _e115 = segmentDistanceSquared(p_7, _e100, _e108);
            squared = min(_e114, _e115);
            float _e117 = squared;
            float _e118 = segmentDistanceSquared(p_7, _e103, _e113);
            squared = min(_e117, _e118);
        }
    }
    float _e126 = squared;
    return ((isInside ? -1.0 : 1.0) * sqrt(_e126));
}

void main() {
    VertexInput input_ = VertexInput(_p2vs_location7, _p2vs_location8, _p2vs_location9, _p2vs_location10, _p2vs_location11, _p2vs_location0, _p2vs_location1, _p2vs_location2, _p2vs_location3, _p2vs_location4, _p2vs_location5, _p2vs_location6, _p2vs_location15, _p2vs_location14, _p2vs_location12);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec4(0.0), vec4(0.0), 0.0, vec2(0.0), vec2(0.0), vec4(0.0), vec3(0.0), vec4(0.0), vec3(0.0), vec4(0.0), 0.0, vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
    bool local = false;
    vec4 _e6 = movePlacement(input_.moveIndex, vec4(input_.rect.xy, input_.axis));
    bool isFlat = (input_.shape.z > 4.5);
    float _e15 = _group_0_binding_0_vs.pixel;
    vec2 flatSize = ((input_.color.w <= 0.0) ? vec2(0.0) : max(input_.rect.zw, vec2(_e15)));
    vec2 size_2 = (isFlat ? flatSize : input_.rect.zw);
    float _e38 = _group_0_binding_0_vs.pixel;
    float padding = (isFlat ? 0.0 : ((input_.shape.y + (input_.outline.x * input_.outline.z)) + _e38));
    vec2 fromOrigin = ((input_.corner * (size_2 + vec2((2.0 * padding)))) - vec2(padding));
    vec2 axis = _e6.zw;
    vec2 world_1 = (_e6.xy + vec2(((axis.x * fromOrigin.x) - (axis.y * fromOrigin.y)), ((axis.y * fromOrigin.x) + (axis.x * fromOrigin.y))));
    vec2 _e72 = _group_0_binding_0_vs.scale;
    vec2 _e76 = _group_0_binding_0_vs.offset;
    output_.position = vec4(((world_1 * _e72) + _e76), 0.0, 1.0);
    float _e84 = _group_0_binding_0_vs.pixel;
    ClipVertex _e85 = clipVertex(world_1, input_.clipIndex, _e84);
    output_.clipLocal = _e85.local;
    output_.clipFrame = _e85.frame;
    float _e92 = layerAlpha(input_.layerTransparency);
    output_.layerAlpha = _e92;
    output_.local = (fromOrigin - (size_2 * 0.5));
    output_.halfSize = (size_2 * 0.5);
    output_.color = input_.color;
    output_.shape = input_.shape;
    output_.strokeColor = input_.strokeColor;
    output_.outline = input_.outline;
    output_.fit = input_.corners;
    float _e113 = _group_0_binding_0_vs.pixel;
    output_.pixel = _e113;
    vec2 _e115 = output_.local;
    vec2 unitBox = mix(((_e115 / size_2) + vec2(0.5)), vec2(0.5), equal(size_2, vec2(0.0)));
    output_.imageT = ((unitBox * input_.imageFit.xy) + input_.imageFit.zw);
    output_.uvRect = input_.uvRect;
    output_.clampRect = input_.clampRect;
    output_.imageWeights = vec4(input_.imageWeights, (size_2 / max(input_.imageFit.xy, vec2(1e-6))));
    float kind_3 = input_.shape.z;
    if ((kind_3 > 1.5)) {
        local = !(isFlat);
    } else {
        local = false;
    }
    bool _e154 = local;
    if (_e154) {
        vec2 halfSize_4 = max((size_2 * 0.5), vec2(0.0001));
        float _e163 = polygonSides(kind_3, input_.outline.y);
        bool _e164 = isStarKind(kind_3);
        vec4 _e165 = polygonFit(halfSize_4, _e163, _e164);
        output_.fit = _e165;
    }
    VertexOutput _e166 = output_;
    gl_Position = _e166.position;
    _vs2fs_location12 = _e166.clipLocal;
    _vs2fs_location13 = _e166.clipFrame;
    _vs2fs_location14 = _e166.layerAlpha;
    _vs2fs_location0 = _e166.local;
    _vs2fs_location1 = _e166.halfSize;
    _vs2fs_location2 = _e166.color;
    _vs2fs_location3 = _e166.shape;
    _vs2fs_location4 = _e166.strokeColor;
    _vs2fs_location5 = _e166.outline;
    _vs2fs_location6 = _e166.fit;
    _vs2fs_location7 = _e166.pixel;
    _vs2fs_location8 = _e166.imageT;
    _vs2fs_location9 = _e166.uvRect;
    _vs2fs_location10 = _e166.clampRect;
    _vs2fs_location11 = _e166.imageWeights;
    return;
}

