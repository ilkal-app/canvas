// The dot grid behind the board (packages/engine/src/scene/grid-background.ts): one
// quad over the whole canvas, drawn first in the scene's render pass, whose fragments light up
// within a dot's radius of the nearest lattice point. Everything is in device pixels from the
// canvas's top-left corner: the CPU reduces the camera to the lattice's phase (the world
// origin's position modulo the spacing), so the numbers stay small at any pan and a pan or
// zoom rewrites only the uniform. Output is premultiplied, like every pass.
// This file is the single source: `pnpm --filter @canvas/engine shaders` generates the
// GLSL ES 3.0 stages and dot-grid.generated.ts from it.

struct Grid {
  // Where a lattice point is, device px from the canvas's top-left corner, reduced modulo the
  // spacing.
  phase: vec2f,
  // The canvas's size, device px.
  size: vec2f,
  // The dots' straight-alpha colour.
  color: vec4f,
  // The distance between neighbouring dots, device px.
  spacing: f32,
  // A dot's radius, device px.
  radius: f32,
  padding: vec2f,
}

@group(0) @binding(0) var<uniform> grid: Grid;

struct VertexOutput {
  @builtin(position) position: vec4f,
  // The fragment's position, device px from the canvas's top-left corner; interpolated, so it
  // is each pixel's centre on both backends (gl_FragCoord and @builtin(position) disagree on
  // which way y runs).
  @location(0) pixel: vec2f,
}

@vertex
fn vertexMain(@location(0) corner: vec2f) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
  output.pixel = corner * grid.size;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let fromPhase = input.pixel - grid.phase;
  let offset = fromPhase - grid.spacing * round(fromPhase / grid.spacing);
  // Coverage falls from 1 to 0 across the last pixel of the radius, so dots are antialiased.
  let coverage = clamp(grid.radius + 0.5 - length(offset), 0.0, 1.0);
  let alpha = grid.color.a * coverage;
  return vec4f(grid.color.rgb * alpha, alpha);
}
