// The path pass (packages/engine/src/paths/path-pass.ts): a path's mesh, in its own
// frame, drawn once per layer record of the persistent instance buffer. The fill is drawn in
// two steps through the stencil (the fans with colour writes off, then the cover quad where the
// even-odd count is set); the stroke is its triangle mesh. The record places the mesh by the
// object's world transform and gives the layer's colour, so a move rewrites one record and never
// the mesh. Output is premultiplied, like every pass.
// This file is the single source: the engine's `shaders` script generates the
// GLSL ES 3.0 stages and path.generated.ts from it.

// Frame clipping: `clipVertex`, `clipCoverage` and the clip table at `@binding(5)` are
// included by scripts/clip-shader.ts; the coverage is multiplied in, never discarded.
// Layer opacity: `layerAlpha` is included there too, and `clipCoverage` multiplies the
// record's opacity into the coverage.

// clip = world * scale + offset (packages/engine/src/camera/camera.ts, cameraClipTransform),
// then the camera uniform's pixel and padding (packages/engine/src/scene/camera-uniform.ts).
struct Camera {
  scale: vec2f,
  offset: vec2f,
  // One device pixel in world units, the width a clip edge is antialiased over.
  pixel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  // Per vertex: a mesh vertex in the path's own frame, world units.
  @location(0) position: vec2f,
  // Per instance: the world rotation as (cos, sin) and the world origin, then the layer's
  // straight-alpha colour.
  @location(1) placement: vec4f,
  @location(2) color: vec4f,
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
  @location(0) color: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let axis = input.placement.xy;
  let world = input.placement.zw + vec2f(
    axis.x * input.position.x - axis.y * input.position.y,
    axis.y * input.position.x + axis.x * input.position.y,
  );
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, input.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  output.layerAlpha = layerAlpha(input.layerTransparency);
  output.color = input.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color.rgb * input.color.a, input.color.a) * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
