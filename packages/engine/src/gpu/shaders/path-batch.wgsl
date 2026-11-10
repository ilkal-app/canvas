// Batched opaque path strokes (packages/engine/src/paths/path-batches.ts): many paths'
// stroke triangles in one draw. Each vertex carries its record's slot, and the record (the
// path's world placement, its layer colour, its clip slot and layer transparency, and its
// retained-move index) is read from the path record texture, three texels per slot, instead of
// from an instance buffer: the instance a draw steps through cannot change within it. The
// arithmetic is the path pass's (path.wgsl), so a batched stroke draws the pixels a per-path draw
// does. Opaque strokes only: they use no stencil, so a run of them may share a draw.
// This file is the single source: `pnpm --filter @canvas/engine shaders` generates the
// GLSL ES 3.0 stages and path-batch.generated.ts from it.

// Frame clipping and layer opacity: `clipVertex`, `clipCoverage`,
// `layerAlpha` and the clip table at `@binding(5)` are included by scripts/clip-shader.ts.

struct Camera {
  scale: vec2f,
  offset: vec2f,
  pixel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

// Retained-move transforms, one texel per moved object: x, y, cos, sin. Index 0, the
// usual case, selects the record's own placement.
@group(0) @binding(4) var moveTransforms: texture_2d<f32>;

// The path records, three texels per slot (paths/path-record-texture.ts): the placement
// (cos, sin, x, y), the straight-alpha colour, then (clip slot, layer transparency, 0, move
// index).
@group(0) @binding(6) var records: texture_2d<f32>;

struct PathRecord {
  placement: vec4f,
  color: vec4f,
  clipIndex: f32,
  layerTransparency: f32,
  moveIndex: f32,
}

fn recordTexel(slot: u32, texel: u32) -> vec4f {
  let width = textureDimensions(records).x;
  let index = slot * 3u + texel;
  return textureLoad(records, vec2i(i32(index % width), i32(index / width)), 0);
}

fn recordAt(slot: u32) -> PathRecord {
  let tail = recordTexel(slot, 2u);
  return PathRecord(recordTexel(slot, 0u), recordTexel(slot, 1u), tail.x, tail.y, tail.w);
}

// The placement the record draws with: a retained move's, as (cos, sin, x, y), when it has one.
fn placementOf(record: PathRecord) -> vec4f {
  if (record.moveIndex == 0.0) { return record.placement; }
  let width = textureDimensions(moveTransforms).x;
  let index = u32(record.moveIndex);
  let moved = textureLoad(moveTransforms, vec2i(i32(index % width), i32(index / width)), 0);
  // Texel 0 holds the session's translation (TransformTable.setOffset).
  let offset = textureLoad(moveTransforms, vec2i(0, 0), 0).xy;
  return vec4f(moved.zw, moved.xy + offset);
}

struct VertexInput {
  // A stroke vertex in its path's own frame, world units.
  @location(0) position: vec2f,
  // The slot of the path's record (exact up to 2^24).
  @location(3) recordSlot: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(12) clipLocal: vec4f,
  @location(13) @interpolate(flat) clipFrame: vec4f,
  @location(14) @interpolate(flat) layerAlpha: f32,
  @location(0) color: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let record = recordAt(u32(input.recordSlot));
  let placement = placementOf(record);
  let axis = placement.xy;
  let world = placement.zw + vec2f(
    axis.x * input.position.x - axis.y * input.position.y,
    axis.y * input.position.x + axis.x * input.position.y,
  );
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, record.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  output.layerAlpha = layerAlpha(record.layerTransparency);
  output.color = record.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color.rgb * input.color.a, input.color.a) * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
