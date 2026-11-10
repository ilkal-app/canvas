// Generated from sdf-shape.wgsl and clip-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
};
const uint MAX_CLIP_DEPTH = 8u;

uniform highp sampler2D _group_0_binding_5_fs;

smooth in vec4 _vs2fs_location12;
flat in vec4 _vs2fs_location13;
flat in float _vs2fs_location14;
smooth in vec2 _vs2fs_location0;
flat in vec2 _vs2fs_location1;
flat in vec4 _vs2fs_location2;
flat in vec3 _vs2fs_location3;
flat in vec4 _vs2fs_location4;
flat in vec3 _vs2fs_location5;
flat in vec4 _vs2fs_location6;
flat in float _vs2fs_location7;
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
    vec2 offset_1 = (world - _e15.xy);
    vec2 local_5 = vec2(((_e15.z * offset_1.x) + (_e15.w * offset_1.y)), ((_e15.z * offset_1.y) - (_e15.w * offset_1.x)));
    vec2 parent = (vec2(((_e19.x * local_5.x) - (_e19.y * local_5.y)), ((_e19.y * local_5.x) + (_e19.x * local_5.y))) + _e19.zw);
    result.local = vec4(local_5, parent);
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

float polygonSides(float kind, float sides) {
    return ((kind < 2.5) ? 4.0 : clamp(roundEven(sides), 3.0, 64.0));
}

bool isStarKind(float kind_1) {
    return (kind_1 > 3.5);
}

vec2 unitPolygonVertex(float index_1, float sides_1, bool isStar) {
    bool local_3 = false;
    float step_ = (isStar ? (3.1415927 / sides_1) : (6.2831855 / sides_1));
    float angle = (index_1 * step_);
    if (isStar) {
        local_3 = ((index_1 - (2.0 * floor((index_1 * 0.5)))) > 0.5);
    } else {
        local_3 = false;
    }
    bool isInner = local_3;
    float radius_4 = (isInner ? (0.5 * cos((3.1415927 / sides_1))) : 1.0);
    return vec2((radius_4 * sin(angle)), (-(radius_4) * cos(angle)));
}

vec4 polygonFit(vec2 halfSize, float sides_2, bool isStar_1) {
    vec2 low = vec2(1000000000.0);
    vec2 high = vec2(-1000000000.0);
    int index_2 = 0;
    int count_1 = int((isStar_1 ? (2.0 * sides_2) : sides_2));
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e25 = index_2;
            index_2 = (_e25 + 1);
        }
        loop_init_1 = false;
        int _e15 = index_2;
        if ((_e15 < count_1)) {
        } else {
            break;
        }
        {
            int _e17 = index_2;
            vec2 _e19 = unitPolygonVertex(float(_e17), sides_2, isStar_1);
            vec2 _e20 = low;
            low = min(_e20, _e19);
            vec2 _e22 = high;
            high = max(_e22, _e19);
        }
    }
    vec2 _e27 = low;
    vec2 _e28 = high;
    vec2 _e34 = high;
    vec2 _e35 = low;
    return vec4(((_e27 + _e28) * 0.5), ((2.0 * halfSize) / max((_e34 - _e35), vec2(1e-6))));
}

float cornerRadiusAt(vec2 p_2, vec4 corners) {
    float left_1 = ((p_2.y < 0.0) ? corners.x : corners.w);
    float right_1 = ((p_2.y < 0.0) ? corners.y : corners.z);
    return ((p_2.x < 0.0) ? left_1 : right_1);
}

float roundedBoxDistance(vec2 p_3, vec2 halfSize_1, float radius_1) {
    vec2 q_1 = ((abs(p_3) - halfSize_1) + vec2(radius_1));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - radius_1);
}

float ellipseDistance(vec2 p_4, vec2 radii_1) {
    float k0_ = length((p_4 / radii_1));
    float k1_ = length((p_4 / (radii_1 * radii_1)));
    return ((k1_ < 1e-6) ? -(min(radii_1.x, radii_1.y)) : ((k0_ * (k0_ - 1.0)) / k1_));
}

float outlineOuterDistance(vec2 p_5, vec2 halfSize_2, float radius_2, float kind_2, float distance_2, float outward) {
    if ((kind_2 < 0.5)) {
        float _e15 = roundedBoxDistance(p_5, (halfSize_2 + vec2(outward)), ((radius_2 > 0.0) ? (radius_2 + outward) : 0.0));
        return _e15;
    }
    return (distance_2 - outward);
}

float segmentDistanceSquared(vec2 p_6, vec2 start, vec2 end) {
    vec2 edge = (end - start);
    float along = clamp((dot((p_6 - start), edge) / max(dot(edge, edge), 1e-12)), 0.0, 1.0);
    vec2 gap = ((p_6 - start) - (edge * along));
    return dot(gap, gap);
}

vec2 placedPolygonVertex(float index_3, float count, vec4 fit, float sides_3, bool isStar_2) {
    float wrapped = (index_3 - (count * floor((index_3 / count))));
    vec2 _e9 = unitPolygonVertex(wrapped, sides_3, isStar_2);
    return ((_e9 - fit.xy) * fit.zw);
}

float unitPolygonInradius(float sides_4, bool isStar_3) {
    vec2 _e3 = unitPolygonVertex(0.0, sides_4, isStar_3);
    vec2 _e5 = unitPolygonVertex(1.0, sides_4, isStar_3);
    float _e8 = segmentDistanceSquared(vec2(0.0), _e3, _e5);
    return sqrt(_e8);
}

float polygonDistance(vec2 p_7, vec4 fit_1, float sides_5, bool isStar_4, float band) {
    bool local_4 = false;
    float squared = 0.0;
    float offset = 1.0;
    float count_2 = (isStar_4 ? (2.0 * sides_5) : sides_5);
    float step_1 = (isStar_4 ? (3.1415927 / sides_5) : (6.2831855 / sides_5));
    vec2 unit = ((p_7 / fit_1.zw) + fit_1.xy);
    float turned = atan(unit.x, -(unit.y));
    float angle_1 = ((turned < 0.0) ? (turned + 6.2831855) : turned);
    float sector = min(floor((angle_1 / step_1)), (count_2 - 1.0));
    vec2 _e31 = placedPolygonVertex(sector, count_2, fit_1, sides_5, isStar_4);
    vec2 _e34 = placedPolygonVertex((sector + 1.0), count_2, fit_1, sides_5, isStar_4);
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
        local_4 = (depth >= band);
    } else {
        local_4 = false;
    }
    bool _e76 = local_4;
    if (_e76) {
        return -(depth);
    }
    float near = (radius_5 * smallerScale);
    float spread = ((band < near) ? asin((band / near)) : 3.1415927);
    float reach = min(floor((count_2 * 0.5)), (ceil((spread / step_1)) + 1.0));
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
            vec2 _e100 = placedPolygonVertex((sector - _e98), count_2, fit_1, sides_5, isStar_4);
            float _e101 = offset;
            vec2 _e103 = placedPolygonVertex((sector + _e101), count_2, fit_1, sides_5, isStar_4);
            float _e104 = offset;
            vec2 _e108 = placedPolygonVertex(((sector - _e104) + 1.0), count_2, fit_1, sides_5, isStar_4);
            float _e109 = offset;
            vec2 _e113 = placedPolygonVertex(((sector + _e109) + 1.0), count_2, fit_1, sides_5, isStar_4);
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
    VertexOutput input_1 = VertexOutput(gl_FragCoord, _vs2fs_location12, _vs2fs_location13, _vs2fs_location14, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7);
    float radius = 0.0;
    bool local_1 = false;
    float distance_ = 0.0;
    float strokeAlpha = 0.0;
    float fillShown = 0.0;
    if ((input_1.shape.z > 4.5)) {
        vec4 flat_ = vec4((input_1.color.xyz * input_1.color.w), input_1.color.w);
        float _e16 = clipCoverage(input_1.clipLocal, input_1.clipFrame, input_1.layerAlpha);
        _fs2p_location0 = (flat_ * _e16);
        return;
    }
    vec2 halfSize_3 = max(input_1.halfSize, vec2(0.0001));
    float kind_3 = input_1.shape.z;
    radius = min(input_1.shape.x, min(halfSize_3.x, halfSize_3.y));
    if ((kind_3 < 0.5)) {
        local_1 = any(notEqual(input_1.fit, vec4(0.0)));
    } else {
        local_1 = false;
    }
    bool _e41 = local_1;
    if (_e41) {
        float _e44 = cornerRadiusAt(input_1.local, input_1.fit);
        radius = min(_e44, min(halfSize_3.x, halfSize_3.y));
    }
    float _e50 = radius;
    float _e51 = roundedBoxDistance(input_1.local, halfSize_3, _e50);
    float _e53 = ellipseDistance(input_1.local, halfSize_3);
    distance_ = ((kind_3 > 0.5) ? _e53 : _e51);
    if ((kind_3 > 1.5)) {
        float _e62 = polygonSides(kind_3, input_1.outline.y);
        bool _e65 = isStarKind(kind_3);
        float _e73 = polygonDistance(input_1.local, input_1.fit, _e62, _e65, ((input_1.outline.x + input_1.shape.y) + input_1.pixel));
        distance_ = _e73;
    }
    float edge_2 = max(max(input_1.shape.y, (0.5 * input_1.pixel)), 1e-6);
    float _e83 = distance_;
    float outer = (1.0 - smoothstep(-(edge_2), edge_2, _e83));
    float outward_1 = (input_1.outline.x * input_1.outline.z);
    float _e93 = distance_;
    float inner = (1.0 - smoothstep(-(edge_2), edge_2, (_e93 + (input_1.outline.x - outward_1))));
    float fillAlpha = (input_1.color.w * outer);
    strokeAlpha = (input_1.strokeColor.w * max((outer - inner), 0.0));
    float _e111 = strokeAlpha;
    fillShown = (1.0 - _e111);
    if ((outward_1 > 0.0)) {
        float _e119 = radius;
        float _e120 = distance_;
        float _e121 = outlineOuterDistance(input_1.local, halfSize_3, _e119, kind_3, _e120, outward_1);
        float reach_1 = (1.0 - smoothstep(-(edge_2), edge_2, _e121));
        float overFill = (input_1.strokeColor.w * max((outer - inner), 0.0));
        strokeAlpha = (input_1.strokeColor.w * max((reach_1 - inner), 0.0));
        fillShown = ((outer > 0.0) ? (1.0 - (overFill / outer)) : 1.0);
    }
    float _e144 = strokeAlpha;
    float _e145 = fillShown;
    float alpha_1 = (_e144 + (fillAlpha * _e145));
    float _e150 = strokeAlpha;
    float _e155 = fillShown;
    vec3 rgb = ((input_1.strokeColor.xyz * _e150) + ((input_1.color.xyz * fillAlpha) * _e155));
    float _e162 = clipCoverage(input_1.clipLocal, input_1.clipFrame, input_1.layerAlpha);
    _fs2p_location0 = (vec4(rgb, alpha_1) * _e162);
    return;
}

