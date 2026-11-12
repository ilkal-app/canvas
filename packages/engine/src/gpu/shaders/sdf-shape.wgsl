// SDF shapes: instanced quads shaded by a signed
// distance function chosen per instance (a rounded box, an ellipse, and since a diamond,
// a regular polygon or a star stretched to fill the box), with a soft edge for shadows and an
// outline over the fill, inside the edge, straddling it or outside it. Ported from the prototype's src/render/shapeRenderer.ts. The scene draws it as the
// shape pass (packages/engine/src/shapes/shape-pass.ts: sticky notes), and
// packages/engine/src/shapes/shape-renderer.ts draws it outside a scene; the instance record is
// documented in shape-instance-layout.ts. This file is the single source: the engine's `shaders`
// script generates the GLSL ES 3.0 stages and sdf-shape.generated.ts from it.

// Frame clipping: `clipVertex`, `clipCoverage` and the clip table at `@binding(5)` are
// included by scripts/clip-shader.ts; the coverage is multiplied in, never discarded.
// Layer opacity: `layerAlpha` is included there too, and `clipCoverage` multiplies the
// record's opacity into the coverage.

// The engine's camera uniform, shared by every pass (packages/engine/src/scene/camera-uniform.ts):
// clip = world * scale + offset, then the world size of one device pixel. 32 bytes (std140-safe).
struct Camera {
  scale: vec2f,
  offset: vec2f,
  pixel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  // Per vertex: the corner of the unit quad.
  @location(0) corner: vec2f,
  // Per instance: x, y (the world top-left corner), width, height in world units.
  @location(1) rect: vec4f,
  // Per instance: the fill's straight-alpha colour.
  @location(2) color: vec4f,
  // Per instance: corner radius (world), edge softness (world), kind (0 rounded box, 1 ellipse,
  // 2 diamond, 3 polygon, 4 star, 5 the flat form of a tiny shape:).
  @location(3) shape: vec3f,
  // Per instance: the turn about the top-left corner as (cos, sin); (0, 0) for a released slot.
  @location(4) axis: vec2f,
  // Per instance: the outline's straight-alpha colour.
  @location(5) strokeColor: vec4f,
  // Per instance: the outline's width (world), a polygon's sides or a star's points, and the
  // fraction of the outline's width outside the edge: 0 inside, 0.5 centred, 1
  // outside.
  @location(6) outline: vec3f,
  // Per instance: a rounded box's four corner radii (world), top-left, top-right, bottom-right,
  // bottom-left (a frame's); all 0 draws `shape.x` at every corner, as before. A frame
  // pass's record carries them; the shape passes feed zeros from their per-vertex buffer.
  @location(15) corners: vec4f,
  // Per instance: the clip table slot of the nearest clipping frame above the object, 0 for
  // none (written by the scene, not the pass).
  @location(14) clipIndex: f32,
  // Per instance: 1 minus the object's cumulative layer opacity, its own times its
  // ancestors' (written by the scene, not the pass), 0 for opaque.
  @location(12) layerTransparency: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  // Where the fragment is in its clip chain (scripts/clip-shader.ts, clipVertex).
  @location(12) clipLocal: vec4f,
  @location(13) @interpolate(flat) clipFrame: vec4f,
  // The layer opacity the coverage is multiplied by (scripts/clip-shader.ts).
  @location(14) @interpolate(flat) layerAlpha: f32,
  // Position relative to the shape's centre, world units.
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) halfSize: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
  @location(3) @interpolate(flat) shape: vec3f,
  @location(4) @interpolate(flat) strokeColor: vec4f,
  @location(5) @interpolate(flat) outline: vec3f,
  // How the unit polygon fills the box: its bounds' centre (xy) and world units per unit (zw),
  // so a vertex is at (unit - xy) * zw from the box's centre. For the other kinds, the record's
  // four corner radii, zero but for a rounded frame's.
  @location(6) @interpolate(flat) fit: vec4f,
  // One device pixel in world units (the camera's), the width coverage ramps over.
  @location(7) @interpolate(flat) pixel: f32,
}

const PI = 3.141592653589793;

// A star's inner vertices sit at this fraction of its outer polygon's apothem (shape-distance.ts,
// STAR_INNER_SCALE).
const STAR_INNER_SCALE = 0.5;

// The most sides a polygon, or points a star, may have (the schema's MAX_SHAPE_SIDES).
const MAX_SIDES = 64.0;

// The sides a polygon-family kind walks: a diamond's four, else the instance's, 3 to 64.
fn polygonSides(kind: f32, sides: f32) -> f32 {
  return select(clamp(round(sides), 3.0, MAX_SIDES), 4.0, kind < 2.5);
}

// Whether a kind code is the star's.
fn isStarKind(kind: f32) -> bool {
  return kind > 3.5;
}

// Vertex `index` of the unit polygon or star, the first at the top and the rest clockwise (y
// down); a star's points and inner vertices alternate (shape-distance.ts, unitPolygonVertex).
fn unitPolygonVertex(index: f32, sides: f32, isStar: bool) -> vec2f {
  let step = select(2.0 * PI / sides, PI / sides, isStar);
  let angle = index * step;
  let isInner = isStar && (index - 2.0 * floor(index * 0.5)) > 0.5;
  let radius = select(1.0, STAR_INNER_SCALE * cos(PI / sides), isInner);
  return vec2f(radius * sin(angle), -radius * cos(angle));
}

// Stretches the unit polygon's vertex bounds onto the box (shape-distance.ts, polygonFitOf).
fn polygonFit(halfSize: vec2f, sides: f32, isStar: bool) -> vec4f {
  let count = i32(select(sides, 2.0 * sides, isStar));
  var low = vec2f(1e9);
  var high = vec2f(-1e9);
  for (var index = 0; index < count; index++) {
    let vertex = unitPolygonVertex(f32(index), sides, isStar);
    low = min(low, vertex);
    high = max(high, vertex);
  }
  return vec4f((low + high) * 0.5, 2.0 * halfSize / max(high - low, vec2f(1e-6)));
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  // A tiny shape's flat form (kind 5: SHAPE_FLAT_KIND_CODE): its box unpadded, at least
  // a device pixel each way, and nothing at all when clear (a tiny shape's shadow).
  let isFlat = input.shape.z > 4.5;
  let flatSize = select(max(input.rect.zw, vec2f(camera.pixel)), vec2f(0.0), input.color.a <= 0.0);
  let size = select(input.rect.zw, flatSize, isFlat);
  // Grow the quad so a blurred edge, an outline outside the edge and one device
  // pixel of antialiasing are not cut off.
  let padding = select(input.shape.y + input.outline.x * input.outline.z + camera.pixel, 0.0, isFlat);
  let fromOrigin = input.corner * (size + 2.0 * padding) - padding;
  let axis = input.axis;
  let world = input.rect.xy + vec2f(
    axis.x * fromOrigin.x - axis.y * fromOrigin.y,
    axis.y * fromOrigin.x + axis.x * fromOrigin.y,
  );
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, input.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  output.layerAlpha = layerAlpha(input.layerTransparency);
  output.local = fromOrigin - size * 0.5;
  output.halfSize = size * 0.5;
  output.color = input.color;
  output.shape = input.shape;
  output.strokeColor = input.strokeColor;
  output.outline = input.outline;
  output.fit = input.corners;
  output.pixel = camera.pixel;
  let kind = input.shape.z;
  if (kind > 1.5 && !isFlat) {
    let halfSize = max(size * 0.5, vec2f(1e-4));
    output.fit = polygonFit(halfSize, polygonSides(kind, input.outline.y), isStarKind(kind));
  }
  return output;
}

// The radius of the corner whose quadrant `p` (from the box's centre, y down) lies in:
// `corners` is top-left, top-right, bottom-right, bottom-left. With it, roundedBoxDistance is the
// exact distance to a box whose corners are rounded each by its own radius.
fn cornerRadiusAt(p: vec2f, corners: vec4f) -> f32 {
  let left = select(corners.w, corners.x, p.y < 0.0);
  let right = select(corners.z, corners.y, p.y < 0.0);
  return select(right, left, p.x < 0.0);
}

// Exact distance to a box of half-size `halfSize` whose corners are rounded by `radius`.
fn roundedBoxDistance(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let q = abs(p) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - radius;
}

// Distance to an axis-aligned ellipse with semi-axes `radii`: the implicit function divided by
// its gradient's length, exact on the outline and close near it, which is where coverage is
// decided. The centre, where the gradient vanishes, is a full semi-minor axis inside.
fn ellipseDistance(p: vec2f, radii: vec2f) -> f32 {
  let k0 = length(p / radii);
  let k1 = length(p / (radii * radii));
  return select(k0 * (k0 - 1.0) / k1, -min(radii.x, radii.y), k1 < 1e-6);
}

// Where an outline that reaches `outward` past the edge ends: the edge pushed out by
// `outward`. A rounded box keeps its corners' shape as the design tools do: a rounded corner's
// radius grows by `outward`, and a sharp corner stays sharp (a mitre), so its box is grown rather
// than its distance offset, which would round it. The other kinds offset their distance; their
// corners (a polygon's, a star's points) round by `outward` (by design; mitred ones:).
// Hit testing mirrors this on the CPU (`outlineOuterDistance` in src/shapes/shape-distance.ts).
fn outlineOuterDistance(p: vec2f, halfSize: vec2f, radius: f32, kind: f32, distance: f32, outward: f32) -> f32 {
  if (kind < 0.5) {
    return roundedBoxDistance(p, halfSize + outward, select(0.0, radius + outward, radius > 0.0));
  }
  return distance - outward;
}

// The squared distance from a point to a segment.
fn segmentDistanceSquared(p: vec2f, start: vec2f, end: vec2f) -> f32 {
  let edge = end - start;
  let along = clamp(dot(p - start, edge) / max(dot(edge, edge), 1e-12), 0.0, 1.0);
  let gap = p - start - edge * along;
  return dot(gap, gap);
}

// Vertex `index` of the polygon or star placed in the box (world units from its centre), the
// index taken round the vertex count.
fn placedPolygonVertex(index: f32, count: f32, fit: vec4f, sides: f32, isStar: bool) -> vec2f {
  let wrapped = index - count * floor(index / count);
  return (unitPolygonVertex(wrapped, sides, isStar) - fit.xy) * fit.zw;
}

// The radius of the largest circle about the unit polygon's or star's centre inside it: the
// distance from the centre to its first edge, all edges being alike (shape-distance.ts,
// unitPolygonInradius).
fn unitPolygonInradius(sides: f32, isStar: bool) -> f32 {
  let first = unitPolygonVertex(0.0, sides, isStar);
  let second = unitPolygonVertex(1.0, sides, isStar);
  return sqrt(segmentDistanceSquared(vec2f(0.0), first, second));
}

// Distance to the stretched polygon or star, walking only the edges that can be within `band` of
// the point (fix round 1: walking all 2 × 64 edges of a star per fragment cost about 4 ms
// of GPU time on a screen-filling one). In the unit polygon's space the shape is regular about
// the origin and every ray from it crosses the outline once, so the point's angular sector names
// one edge, whose side gives the sign exactly (an affine stretch keeps sides). An edge m sectors
// away is at least ρ·sin((m − 1)·step) from the point in that space (ρ its distance from the
// centre), so at least that times the smaller stretch in the world: the walk takes the sector's
// edge and its neighbours out to where that bound passes `band`, all of them near the centre. A
// point inside the largest centred circle deeper than `band` is answered by that circle alone.
// Exact wherever the distance is under `band` (the outline's width plus a pixel: everything
// coverage depends on), at least `band` elsewhere. shape-distance.ts, bandedPolygonDistance.
fn polygonDistance(p: vec2f, fit: vec4f, sides: f32, isStar: bool, band: f32) -> f32 {
  let count = select(sides, 2.0 * sides, isStar);
  let step = select(2.0 * PI / sides, PI / sides, isStar);
  let unit = p / fit.zw + fit.xy;
  let turned = atan2(unit.x, -unit.y);
  let angle = select(turned, turned + 2.0 * PI, turned < 0.0);
  let sector = min(floor(angle / step), count - 1.0);
  let start = placedPolygonVertex(sector, count, fit, sides, isStar);
  let end = placedPolygonVertex(sector + 1.0, count, fit, sides, isStar);
  // Sides compared in the world: the centre is at -fit.xy × fit.zw.
  let centre = -fit.xy * fit.zw;
  let edge = end - start;
  let pointSide = edge.x * (p.y - start.y) - edge.y * (p.x - start.x);
  let centreSide = edge.x * (centre.y - start.y) - edge.y * (centre.x - start.x);
  let isInside = pointSide * centreSide >= 0.0;
  let smallerScale = min(fit.z, fit.w);
  let radius = length(unit);
  let depth = (unitPolygonInradius(sides, isStar) - radius) * smallerScale;
  if (isInside && depth >= band) {
    return -depth;
  }
  let near = radius * smallerScale;
  let spread = select(PI, asin(band / near), band < near);
  let reach = min(floor(count * 0.5), ceil(spread / step) + 1.0);
  var squared = segmentDistanceSquared(p, start, end);
  for (var offset = 1.0; offset <= reach; offset += 1.0) {
    let before = placedPolygonVertex(sector - offset, count, fit, sides, isStar);
    let after = placedPolygonVertex(sector + offset, count, fit, sides, isStar);
    let beforeNext = placedPolygonVertex(sector - offset + 1.0, count, fit, sides, isStar);
    let afterNext = placedPolygonVertex(sector + offset + 1.0, count, fit, sides, isStar);
    squared = min(squared, segmentDistanceSquared(p, before, beforeNext));
    squared = min(squared, segmentDistanceSquared(p, after, afterNext));
  }
  return select(1.0, -1.0, isInside) * sqrt(squared);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // The flat form: its average colour, the area fraction already in its alpha.
  if (input.shape.z > 4.5) {
    let flat = vec4f(input.color.rgb * input.color.a, input.color.a);
    return flat * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
  }
  let halfSize = max(input.halfSize, vec2f(1e-4));
  let kind = input.shape.z;
  var radius = min(input.shape.x, min(halfSize.x, halfSize.y));
  // A rounded box with its own corner radii (a rounded frame); all 0 keeps `shape.x`.
  if (kind < 0.5 && any(input.fit != vec4f(0.0))) {
    radius = min(cornerRadiusAt(input.local, input.fit), min(halfSize.x, halfSize.y));
  }
  let boxDistance = roundedBoxDistance(input.local, halfSize, radius);
  let ovalDistance = ellipseDistance(input.local, halfSize);
  var distance = select(boxDistance, ovalDistance, kind > 0.5);
  // The polygon kinds walk their edges only where drawn.
  if (kind > 1.5) {
    let sides = polygonSides(kind, input.outline.y);
    // Exact within the outline, the soft edge (a drop shadow's blur) and a pixel.
    distance = polygonDistance(input.local, input.fit, sides, isStarKind(kind), input.outline.x + input.shape.y + input.pixel);
  }
  // Softness 0: a crisp edge whose coverage ramps over one device pixel, centred on the edge (a
  // box filter's width: the distances are in world units with a gradient of length 1, so one
  // pixel is `input.pixel` of distance at any zoom and turn). A pixel whose centre is half a pixel
  // inside an edge is fully covered and one half a pixel outside untouched, so a rectangle on
  // pixel boundaries draws exactly its pixels, as flat quads do. (The camera's pixel rather than
  // fwidth: fwidth sums both axes' changes and, across a box's corner diagonal, doubles, which
  // would soften pixel-aligned corners.) Larger: a blur of that half-width, in world units.
  let edge = max(max(input.shape.y, 0.5 * input.pixel), 1e-6);
  let outer = 1.0 - smoothstep(-edge, edge, distance);
  // The outline is a band `outline.x` wide, `outward` of it outside the edge and the rest inside,
  // laid over the fill; width 0 is no band, so an instance without an outline draws
  // exactly its fill.
  let outward = input.outline.x * input.outline.z;
  let inner = 1.0 - smoothstep(-edge, edge, distance + (input.outline.x - outward));
  let fillAlpha = input.color.a * outer;
  // Inside the edge (`outward` 0, every outline before): the band's coverage is laid
  // over the fill's, as it always was, so those pixels are unchanged.
  var strokeAlpha = input.strokeColor.a * max(outer - inner, 0.0);
  var fillShown = 1.0 - strokeAlpha;
  if (outward > 0.0) {
    // Reaching outside: the band past the edge covers no fill, so coverages add there rather than
    // compose (no seam at the edge): the fill shows where the band inside the edge leaves it.
    let reach = 1.0 - smoothstep(-edge, edge, outlineOuterDistance(input.local, halfSize, radius, kind, distance, outward));
    let overFill = input.strokeColor.a * max(outer - inner, 0.0);
    strokeAlpha = input.strokeColor.a * max(reach - inner, 0.0);
    fillShown = select(1.0, 1.0 - overFill / outer, outer > 0.0);
  }
  let alpha = strokeAlpha + fillAlpha * fillShown;
  let rgb = input.strokeColor.rgb * strokeAlpha + input.color.rgb * fillAlpha * fillShown;
  return vec4f(rgb, alpha) * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
