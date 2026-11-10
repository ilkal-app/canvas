// Generated from glyph-edge.wgsl and clip-shader.ts and move-shader.ts by packages/engine/scripts/compile-shaders.ts with naga 30.0.1. Do not edit.
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
    vec2 start;
    vec2 control;
    vec2 end;
    vec2 corner;
    float side;
    vec2 previousNormal;
    vec2 nextNormal;
    vec2 joins;
    vec4 placement;
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
    vec2 curve;
    float distance_;
    float side;
    float previousDistance;
    float nextDistance;
    vec2 joins;
    float beyondStart;
    float beyondEnd;
    vec2 lineNormal;
    vec4 curveGradients;
    vec4 neighbourNormals;
};
struct Polygon {
    vec2 points[8];
    uint count;
};
const float REACH_PX = 1.0;
const uint MAX_CLIP_DEPTH = 8u;

layout(std140) uniform Camera_block_0Vertex { Camera _group_0_binding_0_vs; };

uniform highp sampler2D _group_0_binding_5_vs;

uniform highp sampler2D _group_0_binding_4_vs;

layout(location = 7) in float _p2vs_location7;
layout(location = 0) in vec2 _p2vs_location0;
layout(location = 3) in vec2 _p2vs_location3;
layout(location = 4) in vec2 _p2vs_location4;
layout(location = 5) in vec2 _p2vs_location5;
layout(location = 6) in float _p2vs_location6;
layout(location = 8) in vec2 _p2vs_location8;
layout(location = 9) in vec2 _p2vs_location9;
layout(location = 10) in vec2 _p2vs_location10;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
layout(location = 14) in float _p2vs_location14;
layout(location = 12) in float _p2vs_location12;
smooth out vec4 _vs2fs_location12;
flat out vec4 _vs2fs_location13;
flat out float _vs2fs_location14;
smooth out vec4 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;
smooth out float _vs2fs_location2;
flat out float _vs2fs_location3;
smooth out float _vs2fs_location4;
smooth out float _vs2fs_location5;
flat out vec2 _vs2fs_location6;
smooth out float _vs2fs_location7;
smooth out float _vs2fs_location8;
flat out vec2 _vs2fs_location9;
flat out vec4 _vs2fs_location10;
flat out vec4 _vs2fs_location11;

vec4 clipTexel(uint slot, uint texel) {
    uint index_4 = ((slot * 4u) + texel);
    uint width = uvec2(textureSize(_group_0_binding_5_vs, 0).xy).x;
    vec4 _e15 = texelFetch(_group_0_binding_5_vs, ivec2(int((index_4 % width)), int((index_4 / width))), 0);
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
        uint own_1 = uint(-(frame.z));
        vec4 _e17 = clipTexel(own_1, 3u);
        float _e18 = clipRoundedDistance(local.xy, frame.xy, _e17);
        distance_ = _e18;
        vec4 _e20 = clipTexel(own_1, 1u);
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

vec4 movePlacement(float index_1, vec4 fallback) {
    if ((index_1 == 0.0)) {
        return fallback;
    }
    uint width_1 = uvec2(textureSize(_group_0_binding_4_vs, 0).xy).x;
    uint slot_3 = uint(index_1);
    vec4 placed_1 = texelFetch(_group_0_binding_4_vs, ivec2(int((slot_3 % width_1)), int((slot_3 / width_1))), 0);
    vec4 _e21 = texelFetch(_group_0_binding_4_vs, ivec2(0, 0), 0);
    vec2 offset_1 = _e21.xy;
    return vec4((placed_1.xy + offset_1), placed_1.zw);
}

vec2 turned(vec2 axis, vec2 vector) {
    return vec2(((axis.x * vector.x) - (axis.y * vector.y)), ((axis.y * vector.x) + (axis.x * vector.y)));
}

vec2 placed(vec2 axis_1, vec2 origin, vec2 point) {
    vec2 _e3 = turned(axis_1, point);
    return (origin + _e3);
}

float boxCoverage(float distance_1, vec2 normal) {
    float a = max(abs(normal.x), abs(normal.y));
    float b = min(abs(normal.x), abs(normal.y));
    float inside = -(distance_1);
    float half_1 = (0.5 * (a + b));
    float middle = (0.5 * (a - b));
    float linear = (0.5 + (inside / max(a, 1e-6)));
    float twoAb = max(((2.0 * a) * b), 1e-6);
    float upper = (1.0 - (((half_1 - inside) * (half_1 - inside)) / twoAb));
    float lower = (((half_1 + inside) * (half_1 + inside)) / twoAb);
    float tail = ((inside > 0.0) ? upper : lower);
    float curved = ((abs(inside) <= middle) ? linear : tail);
    float profile = ((b < 0.0001) ? clamp((0.5 + inside), 0.0, 1.0) : curved);
    return clamp(((abs(inside) >= half_1) ? ((inside > 0.0) ? 1.0 : 0.0) : profile), 0.0, 1.0);
}

Polygon clipped(Polygon polygon, vec2 normal_1, float distance_2) {
    Polygon input_2 = Polygon(vec2[8](vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0)), 0u);
    Polygon output_1 = Polygon(vec2[8](vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0)), 0u);
    uint index_2 = 0u;
    input_2 = polygon;
    output_1.count = 0u;
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            uint _e58 = index_2;
            index_2 = (_e58 + 1u);
        }
        loop_init_1 = false;
        uint _e9 = index_2;
        uint _e11 = input_2.count;
        if ((_e9 < _e11)) {
        } else {
            break;
        }
        {
            uint _e14 = index_2;
            vec2 p_2 = input_2.points[_e14];
            uint _e18 = index_2;
            uint _e22 = input_2.count;
            vec2 q_1 = input_2.points[((_e18 + 1u) % _e22)];
            float dp = (distance_2 + dot(p_2, normal_1));
            float dq = (distance_2 + dot(q_1, normal_1));
            if ((dp <= 0.0)) {
                uint _e34 = output_1.count;
                output_1.points[_e34] = p_2;
                uint _e37 = output_1.count;
                output_1.count = (_e37 + 1u);
            }
            if (((dp <= 0.0) != (dq <= 0.0))) {
                uint _e47 = output_1.count;
                output_1.points[_e47] = (p_2 + ((q_1 - p_2) * (dp / (dp - dq))));
                uint _e55 = output_1.count;
                output_1.count = (_e55 + 1u);
            }
        }
    }
    Polygon _e61 = output_1;
    return _e61;
}

float areaOf(Polygon polygon_1) {
    Polygon input_3 = Polygon(vec2[8](vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0)), 0u);
    float twice = 0.0;
    uint index_3 = 0u;
    input_3 = polygon_1;
    bool loop_init_2 = true;
    while(true) {
        if (!loop_init_2) {
            uint _e32 = index_3;
            index_3 = (_e32 + 1u);
        }
        loop_init_2 = false;
        uint _e6 = index_3;
        uint _e8 = input_3.count;
        if ((_e6 < _e8)) {
        } else {
            break;
        }
        {
            uint _e11 = index_3;
            vec2 p_3 = input_3.points[_e11];
            uint _e15 = index_3;
            uint _e19 = input_3.count;
            vec2 q_2 = input_3.points[((_e15 + 1u) % _e19)];
            float _e23 = twice;
            twice = (_e23 + ((p_3.x * q_2.y) - (q_2.x * p_3.y)));
        }
    }
    float _e35 = twice;
    return abs((0.5 * _e35));
}

float joined(float own, vec2 normal_2, float distance_3, vec2 neighbourNormal, float neighbourDistance, float join) {
    Polygon square = Polygon(vec2[8](vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0)), 0u);
    if ((abs(join) < 0.5)) {
        return own;
    }
    square.points[0] = vec2(-0.5, -0.5);
    square.points[1] = vec2(0.5, -0.5);
    square.points[2] = vec2(0.5, 0.5);
    square.points[3] = vec2(-0.5, 0.5);
    square.count = 4u;
    Polygon _e32 = square;
    Polygon _e33 = clipped(_e32, neighbourNormal, neighbourDistance);
    Polygon _e34 = clipped(_e33, normal_2, distance_3);
    float _e35 = areaOf(_e34);
    float _e36 = areaOf(_e33);
    return clamp(((join > 0.5) ? _e35 : ((own + _e36) - _e35)), 0.0, 1.0);
}

void main() {
    VertexInput input_ = VertexInput(_p2vs_location7, _p2vs_location0, _p2vs_location3, _p2vs_location4, _p2vs_location5, _p2vs_location6, _p2vs_location8, _p2vs_location9, _p2vs_location10, _p2vs_location1, _p2vs_location2, _p2vs_location14, _p2vs_location12);
    VertexOutput output_ = VertexOutput(vec4(0.0), vec4(0.0), vec4(0.0), 0.0, vec4(0.0), vec2(0.0), 0.0, 0.0, 0.0, 0.0, vec2(0.0), 0.0, 0.0, vec2(0.0), vec4(0.0), vec4(0.0));
    vec4 _e7 = movePlacement(input_.moveIndex, vec4(input_.placement.zw, input_.placement.xy));
    vec2 axis_2 = _e7.zw;
    vec2 _e11 = placed(axis_2, _e7.xy, input_.start);
    vec2 _e14 = placed(axis_2, _e7.xy, input_.control);
    vec2 _e17 = placed(axis_2, _e7.xy, input_.end);
    vec2 chord = (_e17 - _e11);
    float chordLength = length(chord);
    vec2 along = ((chordLength > 0.0) ? (chord / vec2(max(chordLength, 1e-12))) : vec2(1.0, 0.0));
    vec2 left_1 = vec2(-(along.y), along.x);
    float _e37 = _group_0_binding_0_vs.pixel;
    float reach = (REACH_PX * _e37);
    vec2 toControl = (_e14 - _e11);
    float alongControl = dot(toControl, along);
    float acrossControl = dot(toControl, left_1);
    float x = ((input_.corner.x > 0.0) ? (max(chordLength, alongControl) + reach) : (min(0.0, alongControl) - reach));
    float y = ((input_.corner.y > 0.0) ? (max(0.0, acrossControl) + reach) : (min(0.0, acrossControl) - reach));
    vec2 world_1 = ((_e11 + (along * x)) + (left_1 * y));
    vec2 _e71 = _group_0_binding_0_vs.scale;
    vec2 _e75 = _group_0_binding_0_vs.offset;
    output_.position = vec4(((world_1 * _e71) + _e75), 0.0, 1.0);
    float _e83 = _group_0_binding_0_vs.pixel;
    ClipVertex _e84 = clipVertex(world_1, input_.clipIndex, _e83);
    output_.clipLocal = _e84.local;
    output_.clipFrame = _e84.frame;
    float _e91 = layerAlpha(input_.layerTransparency);
    output_.layerAlpha = _e91;
    output_.color = input_.color;
    float _e100 = _group_0_binding_0_vs.pixel;
    output_.distance_ = ((sign(input_.side) * y) / _e100);
    vec2 toEnd = (_e17 - _e11);
    float determinant_ = ((toControl.x * toEnd.y) - (toControl.y * toEnd.x));
    vec2 offset_2 = (world_1 - _e11);
    float s = (((offset_2.x * toEnd.y) - (offset_2.y * toEnd.x)) / ((abs(determinant_) > 0.0) ? determinant_ : 1.0));
    float t = (((toControl.x * offset_2.y) - (toControl.y * offset_2.x)) / ((abs(determinant_) > 0.0) ? determinant_ : 1.0));
    output_.curve = ((s * vec2(0.5, 0.0)) + (t * vec2(1.0, 1.0)));
    output_.side = input_.side;
    vec2 _e152 = turned(axis_2, input_.previousNormal);
    float _e157 = _group_0_binding_0_vs.pixel;
    output_.previousDistance = (dot((world_1 - _e11), normalize(_e152)) / _e157);
    vec2 _e162 = turned(axis_2, input_.nextNormal);
    float _e167 = _group_0_binding_0_vs.pixel;
    output_.nextDistance = (dot((world_1 - _e17), normalize(_e162)) / _e167);
    output_.joins = input_.joins;
    output_.lineNormal = left_1;
    float _e174 = _group_0_binding_0_vs.pixel;
    float inverse_ = (_e174 / ((abs(determinant_) > 0.0) ? determinant_ : 1.0));
    vec2 gradientS = (vec2(toEnd.y, -(toEnd.x)) * inverse_);
    vec2 gradientT = (vec2(-(toControl.y), toControl.x) * inverse_);
    output_.curveGradients = vec4(((0.5 * gradientS) + gradientT), gradientT);
    vec2 _e198 = turned(axis_2, input_.previousNormal);
    vec2 _e201 = turned(axis_2, input_.nextNormal);
    output_.neighbourNormals = vec4(normalize(_e198), normalize(_e201));
    float _e208 = _group_0_binding_0_vs.pixel;
    output_.beyondStart = (-(x) / _e208);
    float _e214 = _group_0_binding_0_vs.pixel;
    output_.beyondEnd = ((x - chordLength) / _e214);
    VertexOutput _e216 = output_;
    gl_Position = _e216.position;
    _vs2fs_location12 = _e216.clipLocal;
    _vs2fs_location13 = _e216.clipFrame;
    _vs2fs_location14 = _e216.layerAlpha;
    _vs2fs_location0 = _e216.color;
    _vs2fs_location1 = _e216.curve;
    _vs2fs_location2 = _e216.distance_;
    _vs2fs_location3 = _e216.side;
    _vs2fs_location4 = _e216.previousDistance;
    _vs2fs_location5 = _e216.nextDistance;
    _vs2fs_location6 = _e216.joins;
    _vs2fs_location7 = _e216.beyondStart;
    _vs2fs_location8 = _e216.beyondEnd;
    _vs2fs_location9 = _e216.lineNormal;
    _vs2fs_location10 = _e216.curveGradients;
    _vs2fs_location11 = _e216.neighbourNormals;
    return;
}

