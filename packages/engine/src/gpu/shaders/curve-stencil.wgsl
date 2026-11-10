// The stencil pass of a non-zero fill with curved edges: triangles placed in device
// pixels, each vertex carrying Loop–Blinn coordinates (SIGGRAPH 2005). A quadratic's control
// triangle gives its corners (0, 0), (½, 0) and (1, 1), so the curve is u² = v and the region
// between the curve and its chord is u² − v < 0; fragments past the curve are discarded. Fan
// triangles give every corner (0, 1), which never discards. No colour is written: the stencil
// counts windings, and a cover pass paints where the count is not 0.
// This file is the single source: `pnpm --filter @canvas/engine shaders` generates the
// GLSL ES 3.0 stages and curve-stencil.generated.ts from it.

struct Frame {
  viewportSizePx: vec2f,
  padding: vec2f,
}

@group(0) @binding(0) var<uniform> frame: Frame;

struct VertexInput {
  @location(0) positionPx: vec2f,
  @location(1) curve: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) curve: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let clip = vec2f(
    input.positionPx.x / frame.viewportSizePx.x * 2.0 - 1.0,
    1.0 - input.positionPx.y / frame.viewportSizePx.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
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
