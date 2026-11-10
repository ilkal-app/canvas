// The image pass (packages/engine/src/images/image-pass.ts): one
// instanced quad per image, or per resident tile of a tiled image, placed by the object's world
// transform and sampled from the level the texture manager has resident: its own texture or an
// atlas page. A record with no level yet draws its image's average colour from a white texel.
// Samples are clamped half a texel inside the record's rectangle of the page, so atlas
// neighbours never bleed in. Levels are stored premultiplied (the decode job premultiplies), so
// filtering never darkens transparent edges. Output is premultiplied, like every pass.
// This file is the single source: `pnpm --filter @canvas/engine shaders` generates the
// GLSL ES 3.0 stages and image.generated.ts from it.

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
@group(0) @binding(1) var pageTexture: texture_2d<f32>;
@group(0) @binding(2) var pageSampler: sampler;

struct VertexInput {
  // Per vertex: the corner of the unit square.
  @location(0) corner: vec2f,
  // Per instance: the object's world origin (x, y) and world rotation (cos, sin).
  @location(1) placement: vec4f,
  // Per instance: the quad in the object's own frame (x, y, width, height), world units.
  @location(2) quad: vec4f,
  // Per instance: the page coordinates at the quad's top-left and bottom-right (u0, v0, u1, v1).
  @location(3) uvRect: vec4f,
  // Per instance: the page rectangle samples stay inside (u0, v0, u1, v1).
  @location(4) clampRect: vec4f,
  // Per instance: the placeholder colour, straight alpha.
  @location(5) color: vec4f,
  // Per instance: the object's opacity, and 1 to draw the texture or 0 to draw the colour.
  @location(6) weights: vec2f,
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
  @location(0) uv: vec2f,
  @location(1) clampRect: vec4f,
  @location(2) color: vec4f,
  @location(3) weights: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let local = input.quad.xy + input.corner * input.quad.zw;
  let axis = input.placement.zw;
  let world = input.placement.xy + vec2f(
    axis.x * local.x - axis.y * local.y,
    axis.y * local.x + axis.x * local.y,
  );
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, input.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  output.layerAlpha = layerAlpha(input.layerTransparency);
  output.uv = mix(input.uvRect.xy, input.uvRect.zw, input.corner);
  output.clampRect = input.clampRect;
  output.color = input.color;
  output.weights = input.weights;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let halfTexel = vec2f(0.5) / vec2f(textureDimensions(pageTexture));
  let uv = clamp(
    input.uv,
    input.clampRect.xy + halfTexel,
    max(input.clampRect.xy + halfTexel, input.clampRect.zw - halfTexel),
  );
  let texel = textureSample(pageTexture, pageSampler, uv);
  let placeholder = vec4f(input.color.rgb * input.color.a, input.color.a);
  return mix(placeholder, texel, input.weights.y) * input.weights.x * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
