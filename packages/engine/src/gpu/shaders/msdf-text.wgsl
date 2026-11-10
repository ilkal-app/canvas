// The text pass: one instanced quad per glyph, placed
// in world units, sampled from a glyph atlas page and antialiased in screen space, output
// premultiplied. Pages are RGBA8 multi-channel distance fields from msdfgen (the distance is
// the median of the three channels) or R8 single-channel fallback fields; both encode
// 0.5 + d / range with the distance d positive inside. Ported from the prototype's
// `src/render/textRenderer.ts`. This file is the single source: `pnpm --filter @canvas/engine
// shaders` generates the GLSL ES 3.0 stages and msdf-text.generated.ts from it.

// The engine's camera uniform, shared by every pass: clip = world * scale + offset
// (packages/engine/src/camera/camera.ts, cameraClipTransform).
struct Camera {
  scale: vec2f,
  offset: vec2f,
}

struct AtlasPage {
  // The page texture's size, in texels.
  sizeTexels: vec2f,
  // The full distance range the fields encode, in texels.
  distanceRangeTexels: f32,
  // 1 for an R8 fallback page, 0 for an RGBA8 MSDF page.
  isSingleChannel: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> page: AtlasPage;
@group(0) @binding(2) var atlasTexture: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;

struct VertexInput {
  // Per vertex: the corner of the unit quad.
  @location(0) corner: vec2f,
  // Per instance: the glyph's bitmap rectangle (x, y, width, height) in world units, y down.
  @location(1) rect: vec4f,
  // Per instance: the bitmap's rectangle in the page (u0, v0, u1, v1).
  @location(2) uvRect: vec4f,
  // Per instance: a unorm8x4 colour, straight alpha.
  @location(3) color: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  // Interpolate only the glyph-local offset to preserve subtexel precision.
  @location(0) uv: vec2f,
  @location(2) @interpolate(flat) atlasOrigin: vec2f,
  @location(1) color: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let world = input.rect.xy + input.corner * input.rect.zw;
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  output.uv = (input.uvRect.zw - input.uvRect.xy) * input.corner;
  output.atlasOrigin = input.uvRect.xy;
  output.color = input.color;
  return output;
}

fn median3(sample: vec3f) -> f32 {
  return max(min(sample.r, sample.g), min(max(sample.r, sample.g), sample.b));
}

// Filter distance fields in f32 to limit amplification of subpixel sampling differences.
// Hardware filter-weight quantization adds error before the distance-to-coverage scale.
fn sampleAtlas(uv: vec2f) -> vec4f {
  let position = uv * page.sizeTexels - vec2f(0.5);
  let base = vec2i(floor(position));
  let fraction = fract(position);
  let last = vec2i(page.sizeTexels) - vec2i(1);
  let a = textureLoad(atlasTexture, clamp(base, vec2i(0), last), 0);
  let b = textureLoad(atlasTexture, clamp(base + vec2i(1, 0), vec2i(0), last), 0);
  let c = textureLoad(atlasTexture, clamp(base + vec2i(0, 1), vec2i(0), last), 0);
  let d = textureLoad(atlasTexture, clamp(base + vec2i(1, 1), vec2i(0), last), 0);
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texel = sampleAtlas(input.atlasOrigin + input.uv);
  // Mode 1 is a single-channel page; a colour page (mode 2) is not one.
  let field = select(median3(texel.rgb), texel.r, abs(page.isSingleChannel - 1.0) < 0.5);
  // msdfgen's screen-space antialiasing: how many screen pixels the encoded range spans here,
  // so edges stay one pixel wide at any magnification (sharper than the prototype's fwidth of
  // the field, which also blurs where channels disagree).
  let unitRange = vec2f(page.distanceRangeTexels) / page.sizeTexels;
  let screenTexelSize = vec2f(1.0) / fwidth(input.uv);
  let screenPxRange = max(0.5 * dot(unitRange, screenTexelSize), 1.0);
  let coverage = clamp(screenPxRange * (field - 0.5) + 0.5, 0.0, 1.0);
  let alpha = input.color.a * coverage;
  return vec4f(input.color.rgb * alpha, alpha);
}
