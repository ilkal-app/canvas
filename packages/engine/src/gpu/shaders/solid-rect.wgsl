// The scene's solid-rect pass (packages/engine/src/scene/solid-rect-pass.ts):
// one instance per rectangle from the persistent instance buffer, placed in world units by the
// object's world transform and mapped to clip space by the camera uniform, so a pan or zoom
// rewrites only the uniform. Output is premultiplied, like every pass.
// This file is the single source: the engine's `shaders` script generates the
// GLSL ES 3.0 stages and solid-rect.generated.ts from it.

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
  // Per vertex: the corner of the unit square.
  @location(0) corner: vec2f,
  // Per instance: the box's local origin in world units, its size in world units, its world
  // rotation as (cos, sin), and its straight-alpha colour.
  @location(1) origin: vec2f,
  @location(2) size: vec2f,
  @location(3) axis: vec2f,
  @location(4) color: vec4f,
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
  let local = input.corner * input.size;
  let world = input.origin + vec2f(
    input.axis.x * local.x - input.axis.y * local.y,
    input.axis.y * local.x + input.axis.x * local.y,
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
