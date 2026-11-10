// The backend parity scene's pass: instanced triangles placed in device
// pixels, tinted per instance and masked by a texture's red channel, output premultiplied.
// This file is the single source: `pnpm --filter @canvas/engine shaders` generates the
// GLSL ES 3.0 stages and parity-triangle.generated.ts from it.

struct Frame {
  viewportSizePx: vec2f,
  opacity: f32,
  padding: f32,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var maskSampler: sampler;

struct VertexInput {
  // Per vertex: the corner in the instance's unit square, and a unorm8x4 shade.
  @location(0) corner: vec2f,
  @location(1) shade: vec4f,
  // Per instance: placement in device pixels and a straight-alpha colour.
  @location(2) originPx: vec2f,
  @location(3) sizePx: vec2f,
  @location(4) color: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) maskUv: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let pixel = input.originPx + input.corner * input.sizePx;
  let clip = vec2f(
    pixel.x / frame.viewportSizePx.x * 2.0 - 1.0,
    1.0 - pixel.y / frame.viewportSizePx.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.color = input.color * input.shade;
  output.maskUv = input.corner;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let mask = textureSample(maskTexture, maskSampler, input.maskUv).r;
  let alpha = input.color.a * frame.opacity * mask;
  return vec4f(input.color.rgb * alpha, alpha);
}
