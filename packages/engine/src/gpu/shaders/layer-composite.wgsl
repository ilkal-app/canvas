// The layer composite (layer opacity): draws a render target's resolved colour over the
// pass at an opacity, premultiplied source-over. The quad lands at `rect`, the layer's rectangle
// in the pass's clip space (the whole viewport when the pass's viewport is the rectangle), and
// samples the target's top-left `uvScale` part, which is the rectangle's size in device pixels:
// every fragment reads its own texel. This file is the single source: the engine's `shaders` script
// generates the GLSL ES 3.0 stages and layer-composite.generated.ts.

struct Composite {
  // The layer's opacity, in [0, 1].
  opacity: f32,
  // 1 when the target's rows run bottom to top (WebGL2 framebuffers), else 0.
  flipRows: f32,
  // The drawn part of the target: the rectangle's size over the target's, per axis.
  uvScale: vec2f,
  // The rectangle in clip space: left, top, right, bottom.
  rect: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var layerTexture: texture_2d<f32>;
@group(0) @binding(2) var layerSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  // The texel coordinate in the target, x right and y down from its top-left corner.
  @location(0) corner: vec2f,
}

@vertex
fn vertexMain(@location(0) corner: vec2f) -> VertexOutput {
  var output: VertexOutput;
  let rect = composite.rect;
  output.position = vec4f(mix(rect.x, rect.z, corner.x), mix(rect.y, rect.w, corner.y), 0.0, 1.0);
  output.corner = corner * composite.uvScale;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // GL resolves the target's top row into the texture's last row: flip the interpolated v.
  let v = mix(input.corner.y, 1.0 - input.corner.y, composite.flipRows);
  let color = textureSample(layerTexture, layerSampler, vec2f(input.corner.x, v));
  return color * composite.opacity;
}
