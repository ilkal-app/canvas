// The stencil pass of the vector glyph tier (packages/engine/src/text/vector/
// vector-text-pipelines.ts): a text run's glyph triangles, in its object's frame, counted into
// the stencil by a non-zero fill, each vertex carrying Loop–Blinn coordinates (SIGGRAPH 2005),
// with fragments past a quadratic's curve (u² − v > 0) discarded. The run's record places the
// mesh by the object's world transform, as path.wgsl places a path's. No colour is written, so
// there is no clip or layer opacity to apply here: the run's cover quad (path.wgsl) paints where
// the count is not 0, clipped and faded there, and zeroes the stencil, clipped-out pixels too.
// This file is the single source: the engine's `shaders` script generates the
// GLSL ES 3.0 stages, glyph-stencil.generated.ts and its retained-move variant from it.

// clip = world * scale + offset (packages/engine/src/camera/camera.ts, cameraClipTransform),
// then the camera uniform's pixel and padding (packages/engine/src/scene/camera-uniform.ts).
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
  // Per vertex: a glyph triangle's corner in the object's frame, world units, and its
  // Loop–Blinn (u, v): (0, 1) for a fan corner, which never discards.
  @location(0) position: vec2f,
  @location(3) curve: vec2f,
  // Per instance: the world rotation as (cos, sin) and the world origin (the run's record).
  @location(1) placement: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) curve: vec2f,
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
  output.curve = input.curve;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (input.curve.x * input.curve.x - input.curve.y > 0.0) {
    discard;
  }
  return vec4f(0.0);
}
