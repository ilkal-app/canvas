// The edge pass of the vector glyph tier (packages/engine/src/text/vector/
// vector-text-pipelines.ts): one hull per outline edge of a text run, grown by a device pixel
// around the edge, covered by the signed distance to the edge, `clamp(0.5 − d)`, the exact box
// filter of a straight edge. A line's distance is interpolated across its hull; a quadratic's is
// Loop–Blinn's (SIGGRAPH 2005) `f / |∇f|` for `f = u² − v`, from the screen derivatives of (u, v).
// The stencil lets each sample be painted once: where hulls overlap (corners), one edge's coverage
// is used, and the run's cover (path.wgsl) skips what the hulls painted. The run's record places
// the hulls by the object's world transform and gives the colour, as path.wgsl's does.
// This file is the single source: the engine's `shaders` script generates the
// GLSL ES 3.0 stages, glyph-edge.generated.ts and its retained-move variant from it.

// Frame clipping and layer opacity: `clipVertex`, `clipCoverage`,
// `layerAlpha` and the clip table at `@binding(5)` are included by scripts/clip-shader.ts;
// `gammaCorrectedCoverage` by scripts/coverage-gamma-shader.ts.

// clip = world * scale + offset (packages/engine/src/camera/camera.ts, cameraClipTransform),
// then the camera uniform's pixel and padding (packages/engine/src/scene/camera-uniform.ts).
struct Camera {
  scale: vec2f,
  offset: vec2f,
  // One device pixel in world units: how far each hull reaches past its edge.
  pixel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

// How far a hull reaches past its edge, device pixels: the coverage ramp needs half of it.
const REACH_PX: f32 = 1.0;

struct VertexInput {
  // Per vertex: the whole edge in the object's frame, world units (a line's control point is its
  // middle), the hull corner (−1 or +1 along the chord, then across it), and the kind and side:
  // ±1 for a line, +1 when its outside is left of its direction; ±2 for a quadratic, +2 when its
  // inside is on its chord's side.
  @location(0) start: vec2f,
  @location(3) control: vec2f,
  @location(4) end: vec2f,
  @location(5) corner: vec2f,
  @location(6) side: f32,
  // Per vertex: the outward unit normals of the edges before and after this one where they meet
  // it, and how they meet it at its start and its end: +1 convex, −1 reflex, 0 straight on.
  @location(8) previousNormal: vec2f,
  @location(9) nextNormal: vec2f,
  @location(10) joins: vec2f,
  // Per instance: the world rotation as (cos, sin) and the world origin, then the run's
  // straight-alpha colour (the run's record, as path.wgsl reads it).
  @location(1) placement: vec4f,
  @location(2) color: vec4f,
  // Per instance: the clip table slot of the nearest clipping frame above the object, 0 for
  // none (written by the scene, not the pass).
  @location(14) clipIndex: f32,
  // Per instance: 1 minus the object's cumulative layer opacity, 0 for opaque.
  @location(12) layerTransparency: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(12) clipLocal: vec4f,
  @location(13) @interpolate(flat) clipFrame: vec4f,
  @location(14) @interpolate(flat) layerAlpha: f32,
  @location(0) color: vec4f,
  // A quadratic's Loop–Blinn (u, v), affine across its hull.
  @location(1) curve: vec2f,
  // A line's signed distance to its edge, device pixels, positive outside.
  @location(2) distance: f32,
  @location(3) @interpolate(flat) side: f32,
  // The signed distances to the neighbours' lines through the joins, device pixels.
  @location(4) previousDistance: f32,
  @location(5) nextDistance: f32,
  @location(6) @interpolate(flat) joins: vec2f,
  // How far past the edge's start and end, along its chord, device pixels (negative before
  // them): which join's corner is nearer, the one whose neighbour's side joins in.
  @location(7) beyondStart: f32,
  @location(8) beyondEnd: f32,
  // A line's unit normal in device pixel axes, for its exact box-filter profile.
  @location(9) @interpolate(flat) lineNormal: vec2f,
  // A quadratic's ∇u and ∇v per device pixel, in world axes: its outward normal at a pixel, for
  // a corner's exact coverage (screen derivatives' axes need not be the world's).
  @location(10) @interpolate(flat) curveGradients: vec4f,
  // The outward unit normals of the edges before and after, in world axes.
  @location(11) @interpolate(flat) neighbourNormals: vec4f,
}

fn turned(axis: vec2f, vector: vec2f) -> vec2f {
  return vec2f(axis.x * vector.x - axis.y * vector.y, axis.y * vector.x + axis.x * vector.y);
}

fn placed(axis: vec2f, origin: vec2f, point: vec2f) -> vec2f {
  return origin + turned(axis, point);
}

// The exact coverage of a pixel (a unit square) by the half-plane on the far side of a straight
// edge at signed distance `distance` from its centre (positive outside), whose unit normal in
// pixel axes is `normal`: linear across the middle, quadratic in the tails, which reach
// (|nx| + |ny|) / 2 from the centre (half a pixel for an axis-aligned edge, 0.71 at 45°).
fn boxCoverage(distance: f32, normal: vec2f) -> f32 {
  let a = max(abs(normal.x), abs(normal.y));
  let b = min(abs(normal.x), abs(normal.y));
  let inside = -distance;
  let half = 0.5 * (a + b);
  let middle = 0.5 * (a - b);
  let linear = 0.5 + inside / max(a, 1e-6);
  let twoAb = max(2.0 * a * b, 1e-6);
  let upper = 1.0 - (half - inside) * (half - inside) / twoAb;
  let lower = (half + inside) * (half + inside) / twoAb;
  let tail = select(lower, upper, inside > 0.0);
  let curved = select(tail, linear, abs(inside) <= middle);
  // An axis-aligned edge has no tails: its profile is the linear ramp.
  let profile = select(curved, clamp(0.5 + inside, 0.0, 1.0), b < 1e-4);
  return clamp(select(profile, select(0.0, 1.0, inside > 0.0), abs(inside) >= half), 0.0, 1.0);
}

// A convex polygon within a pixel, centred on it, in device pixel axes: a pixel square clipped by
// at most two half-planes has at most six corners.
struct Polygon {
  points: array<vec2f, 8>,
  count: u32,
}

// A polygon clipped by a half-plane (Sutherland–Hodgman): what lies where `distance + p · normal`
// is not positive, the inside of an edge whose outward unit normal is `normal` and which lies
// `distance` from the pixel's centre, positive outside.
fn clipped(polygon: Polygon, normal: vec2f, distance: f32) -> Polygon {
  var input = polygon;
  var output: Polygon;
  output.count = 0u;
  for (var index = 0u; index < input.count; index += 1u) {
    let p = input.points[index];
    let q = input.points[(index + 1u) % input.count];
    let dp = distance + dot(p, normal);
    let dq = distance + dot(q, normal);
    if (dp <= 0.0) {
      output.points[output.count] = p;
      output.count += 1u;
    }
    if ((dp <= 0.0) != (dq <= 0.0)) {
      output.points[output.count] = p + (q - p) * (dp / (dp - dq));
      output.count += 1u;
    }
  }
  return output;
}

// A polygon's area (the shoelace formula).
fn areaOf(polygon: Polygon) -> f32 {
  var input = polygon;
  var twice = 0.0;
  for (var index = 0u; index < input.count; index += 1u) {
    let p = input.points[index];
    let q = input.points[(index + 1u) % input.count];
    twice += p.x * q.y - q.x * p.y;
  }
  return abs(0.5 * twice);
}

// One edge's coverage with its neighbour's at their join, exactly: the pixel square clipped by
// both edges' half-planes. The inside is their intersection at a convex join and their union at a
// reflex one (its own share plus the neighbour's, less the overlap), so pixels at a corner are
// covered as the corner covers them, whichever hull paints them. Each half-plane is given by its
// outward unit normal and its distance from the pixel's centre, positive outside. A product of
// the two shares, or their clamped sum, is exact only for edges at right angles: at a narrow
// notch, or where contours cross at a shallow angle, the half-planes overlap almost wholly.
fn joined(own: f32, normal: vec2f, distance: f32, neighbourNormal: vec2f, neighbourDistance: f32, join: f32) -> f32 {
  if (abs(join) < 0.5) {
    return own;
  }
  var square: Polygon;
  square.points[0] = vec2f(-0.5, -0.5);
  square.points[1] = vec2f(0.5, -0.5);
  square.points[2] = vec2f(0.5, 0.5);
  square.points[3] = vec2f(-0.5, 0.5);
  square.count = 4u;
  let neighbourShare = clipped(square, neighbourNormal, neighbourDistance);
  let both = areaOf(clipped(neighbourShare, normal, distance));
  return clamp(select(own + areaOf(neighbourShare) - both, both, join > 0.5), 0.0, 1.0);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let axis = input.placement.xy;
  let a = placed(axis, input.placement.zw, input.start);
  let c = placed(axis, input.placement.zw, input.control);
  let b = placed(axis, input.placement.zw, input.end);
  let chord = b - a;
  let chordLength = length(chord);
  let along = select(vec2f(1.0, 0.0), chord / max(chordLength, 1e-12), chordLength > 0.0);
  let left = vec2f(-along.y, along.x);
  let reach = REACH_PX * camera.pixel;
  // The hull: the chord-aligned box of the control triangle, grown by the reach all round.
  let toControl = c - a;
  let alongControl = dot(toControl, along);
  let acrossControl = dot(toControl, left);
  let x = select(min(0.0, alongControl) - reach, max(chordLength, alongControl) + reach, input.corner.x > 0.0);
  let y = select(min(0.0, acrossControl) - reach, max(0.0, acrossControl) + reach, input.corner.y > 0.0);
  let world = a + along * x + left * y;
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, input.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  output.layerAlpha = layerAlpha(input.layerTransparency);
  output.color = input.color;
  // A line: the distance across it, its outside's way up. A quadratic: (u, v) at this corner,
  // the barycentric weights of the control triangle, affine in the plane.
  output.distance = sign(input.side) * y / camera.pixel;
  let toEnd = b - a;
  let determinant = toControl.x * toEnd.y - toControl.y * toEnd.x;
  let offset = world - a;
  let s = (offset.x * toEnd.y - offset.y * toEnd.x) / select(1.0, determinant, abs(determinant) > 0.0);
  let t = (toControl.x * offset.y - toControl.y * offset.x) / select(1.0, determinant, abs(determinant) > 0.0);
  output.curve = s * vec2f(0.5, 0.0) + t * vec2f(1.0, 1.0);
  output.side = input.side;
  output.previousDistance = dot(world - a, normalize(turned(axis, input.previousNormal))) / camera.pixel;
  output.nextDistance = dot(world - b, normalize(turned(axis, input.nextNormal))) / camera.pixel;
  output.joins = input.joins;
  // The screen keeps world axes (the camera only scales and moves), so the chord's left normal
  // is its normal in pixel axes.
  output.lineNormal = left;
  // ∇s and ∇t of the barycentric weights above, per device pixel: (u, v) = (s / 2 + t, t).
  let inverse = camera.pixel / select(1.0, determinant, abs(determinant) > 0.0);
  let gradientS = vec2f(toEnd.y, -toEnd.x) * inverse;
  let gradientT = vec2f(-toControl.y, toControl.x) * inverse;
  output.curveGradients = vec4f(0.5 * gradientS + gradientT, gradientT);
  output.neighbourNormals = vec4f(
    normalize(turned(axis, input.previousNormal)),
    normalize(turned(axis, input.nextNormal)),
  );
  output.beyondStart = -x / camera.pixel;
  output.beyondEnd = (x - chordLength) / camera.pixel;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // The derivatives first, in uniform control flow.
  let u = input.curve.x;
  let du = vec2f(dpdx(u), dpdy(u));
  let dv = vec2f(dpdx(input.curve.y), dpdy(input.curve.y));
  let f = u * u - input.curve.y;
  let gradient = length(2.0 * u * du - dv);
  let curveDistance = sign(input.side) * f / max(gradient, 1e-6);
  let isLine = abs(input.side) < 1.5;
  let distance = select(curveDistance, input.distance, isLine);
  let curveNormal = (2.0 * u * du - dv) / max(gradient, 1e-6);
  let own = boxCoverage(distance, select(curveNormal, input.lineNormal, isLine));
  // The edge's outward normal in world axes, as the neighbours' are.
  let worldGradient = 2.0 * u * input.curveGradients.xy - input.curveGradients.zw;
  let curveOutward = sign(input.side) * worldGradient / max(length(worldGradient), 1e-6);
  let outward = select(curveOutward, sign(input.side) * input.lineNormal, isLine);
  // Each join's corner rules the half of the hull nearest it: at a reflex join whose outside is
  // a narrow notch, the neighbour covers pixels before this edge's end too.
  let isNearStart = input.beyondStart > input.beyondEnd;
  let atEnd = joined(
    own,
    outward,
    distance,
    select(input.neighbourNormals.zw, input.neighbourNormals.xy, isNearStart),
    select(input.nextDistance, input.previousDistance, isNearStart),
    select(input.joins.y, input.joins.x, isNearStart),
  );
  let coverage = gammaCorrectedCoverage(atEnd, input.color.rgb);
  return vec4f(input.color.rgb * input.color.a, input.color.a) * coverage * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
