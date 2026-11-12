// The scene's text pass (packages/engine/src/text/scene/text-pass.ts): the MSDF text
// shader of msdf-text.wgsl with each glyph placed in its text object's own frame, so text turns
// with its object (and the groups and frames above it). One instanced quad per glyph from the
// scene's persistent instance buffer, sampled from its page in the draw's page group (
// eight atlas pages bound at once, each glyph naming its page's index in the group), antialiased
// in screen space, output premultiplied. This file is the single
// source: the engine's `shaders` script generates the GLSL ES 3.0 stages and
// scene-text.generated.ts from it.

// Frame clipping: `clipVertex`, `clipCoverage` and the clip table at `@binding(5)` are
// included by scripts/clip-shader.ts; the coverage is multiplied in, never discarded.
// Layer opacity: `layerAlpha` is included there too, and `clipCoverage` multiplies the
// record's opacity into the coverage.

// The engine's camera uniform, shared by every pass: clip = world * scale + offset
// (packages/engine/src/camera/camera.ts, cameraClipTransform), then the size of one device
// pixel in world units (packages/engine/src/scene/camera-uniform.ts), which a greek bar's
// antialiasing reads.
struct Camera {
  scale: vec2f,
  offset: vec2f,
  pixel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

struct AtlasPage {
  // The page texture's size, in texels.
  sizeTexels: vec2f,
  // The full distance range the fields encode, in texels.
  distanceRangeTexels: f32,
  // 0 for an RGBA8 MSDF page, 1 for an R8 fallback page, 2 for an RGBA8 colour page whose
  // premultiplied texels are drawn as they are.
  mode: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
// A page group's pages, by index in the group; a free slot holds a 1 × 1 blank page.
struct AtlasPages {
  pages: array<AtlasPage, 8>,
}

@group(0) @binding(1) var<uniform> group: AtlasPages;
@group(0) @binding(2) var atlasTexture0: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;
@group(0) @binding(6) var atlasTexture1: texture_2d<f32>;
@group(0) @binding(7) var atlasTexture2: texture_2d<f32>;
@group(0) @binding(8) var atlasTexture3: texture_2d<f32>;
@group(0) @binding(9) var atlasTexture4: texture_2d<f32>;
@group(0) @binding(10) var atlasTexture5: texture_2d<f32>;
@group(0) @binding(11) var atlasTexture6: texture_2d<f32>;
@group(0) @binding(12) var atlasTexture7: texture_2d<f32>;

// Stem darkening: text small enough to draw from the 64 px/em tier gains up to 0.15 device
// px of weight, full at or below 12 px/em and fading out by 24 px/em, so gamma-correct edges do not
// thin small text (the platforms darken stems the same way).
const STEM_DARKEN_PX: f32 = 0.15;
const DARKEN_FADE_EM_PX: f32 = 12.0;
const DARKEN_END_EM_PX: f32 = 24.0;
const SMALL_TIER_EM_TEXELS: f32 = 64.0;

struct VertexInput {
  // Per vertex: the corner of the unit quad.
  @location(0) corner: vec2f,
  // Per instance: the object's local origin in world units and its world rotation as
  // (cos, sin).
  @location(1) origin: vec2f,
  @location(2) axis: vec2f,
  // Per instance: the glyph's bitmap rectangle (x, y, width, height) in the object's frame,
  // world units, y down. A zero rectangle (a released or pending record) draws nothing.
  @location(3) rect: vec4f,
  // Per instance: the bitmap's rectangle in the page (u0, v0, u1, v1); all -1 for a greek bar
  // (text under 4 device px a line), which draws in its colour, its top and bottom edges
  // antialiased.
  @location(4) uvRect: vec4f,
  // Per instance: the glyph's straight-alpha colour.
  @location(5) color: vec4f,
  // Per instance: its page's index in the draw's page group, 0 for a greek bar.
  @location(6) pageIndex: f32,
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
  // Interpolate only the glyph-local offset to preserve subtexel precision.
  @location(0) uv: vec2f,
  @location(3) @interpolate(flat) atlasOrigin: vec2f,
  @location(1) color: vec4f,
  // For a greek bar: where the fragment is across the bar's height and the height, both in
  // device pixels from the bar's top edge; unused by a glyph.
  @location(2) bar: vec2f,
  // The glyph page's index in the group.
  @location(4) @interpolate(flat) pageIndex: u32,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  // A greek bar (1 to 1.6 device px tall at 2.5 to 4 px lines) is drawn with its top and bottom
  // edges antialiased, so it neither drops rows nor shimmers while zooming: its quad grows by a
  // device pixel above and below, and each fragment covers the share of its pixel's height the
  // bar overlaps. A bar thinner than a pixel thus draws a pixel at proportionally lower alpha
  // (fix round 1).
  let isBar = input.uvRect.x < 0.0;
  let pad = select(0.0, camera.pixel, isBar);
  let height = input.rect.w + 2.0 * pad;
  let local = vec2f(input.rect.x, input.rect.y - pad) + input.corner * vec2f(input.rect.z, height);
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
  output.uv = (input.uvRect.zw - input.uvRect.xy) * input.corner;
  output.atlasOrigin = input.uvRect.xy;
  output.color = input.color;
  output.pageIndex = u32(clamp(round(input.pageIndex), 0.0, 7.0));
  output.bar = vec2f(input.corner.y * height - pad, input.rect.w) / camera.pixel;
  return output;
}

fn median3(sample: vec3f) -> f32 {
  return max(min(sample.r, sample.g), min(max(sample.r, sample.g), sample.b));
}

// One texel of the group's page at `index`. textureLoad needs no uniform control flow, so each
// glyph picks its own page.
fn loadTexel(index: u32, texel: vec2i) -> vec4f {
  switch index {
    case 1u: { return textureLoad(atlasTexture1, texel, 0); }
    case 2u: { return textureLoad(atlasTexture2, texel, 0); }
    case 3u: { return textureLoad(atlasTexture3, texel, 0); }
    case 4u: { return textureLoad(atlasTexture4, texel, 0); }
    case 5u: { return textureLoad(atlasTexture5, texel, 0); }
    case 6u: { return textureLoad(atlasTexture6, texel, 0); }
    case 7u: { return textureLoad(atlasTexture7, texel, 0); }
    default: { return textureLoad(atlasTexture0, texel, 0); }
  }
}

// Filter distance fields in f32 to limit amplification of subpixel sampling differences.
// Hardware filter-weight quantization adds error before the distance-to-coverage scale.
fn sampleAtlas(uv: vec2f, index: u32, page: AtlasPage) -> vec4f {
  let position = uv * page.sizeTexels - vec2f(0.5);
  let base = vec2i(floor(position));
  let fraction = fract(position);
  let last = vec2i(page.sizeTexels) - vec2i(1);
  let a = loadTexel(index, clamp(base, vec2i(0), last));
  let b = loadTexel(index, clamp(base + vec2i(1, 0), vec2i(0), last));
  let c = loadTexel(index, clamp(base + vec2i(0, 1), vec2i(0), last));
  let d = loadTexel(index, clamp(base + vec2i(1, 1), vec2i(0), last));
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let page = group.pages[input.pageIndex];
  let texel = sampleAtlas(input.atlasOrigin + input.uv, input.pageIndex, page);
  let field = select(median3(texel.rgb), texel.r, abs(page.mode - 1.0) < 0.5);
  // msdfgen's screen-space antialiasing, as in msdf-text.wgsl: how many screen pixels the
  // encoded range spans here, so edges stay one pixel wide at any magnification and rotation.
  let unitRange = vec2f(page.distanceRangeTexels) / page.sizeTexels;
  let screenTexelSize = vec2f(1.0) / fwidth(input.uv);
  let screenPxRange = max(0.5 * dot(unitRange, screenTexelSize), 1.0);
  // How many device px this glyph's em spans, read from the 64 px/em tier's scale: larger tiers
  // come out at 24 px/em or more and are not darkened.
  let emPx = SMALL_TIER_EM_TEXELS * screenPxRange / page.distanceRangeTexels;
  let darkenPx = STEM_DARKEN_PX * clamp((DARKEN_END_EM_PX - emPx) / DARKEN_FADE_EM_PX, 0.0, 1.0);
  let glyphCoverage = clamp(screenPxRange * (field - 0.5) + 0.5 + darkenPx, 0.0, 1.0);
  // A greek bar: sampled like a glyph above, so every derivative stays in uniform control
  // flow, then its coverage replaced by the share of this pixel's height it overlaps.
  let barCoverage = clamp(min(input.bar.x + 0.5, input.bar.y) - max(input.bar.x - 0.5, 0.0), 0.0, 1.0);
  let coverage = select(glyphCoverage, barCoverage, input.atlasOrigin.x < 0.0);
  // The canvas blends sRGB-encoded values: the coverage is corrected so the text blends as in
  // linear light (scripts/coverage-gamma-shader.ts).
  let corrected = gammaCorrectedCoverage(coverage, input.color.rgb);
  let alpha = input.color.a * corrected;
  // A colour glyph: its premultiplied texel, faded by the run's alpha; a greek bar on a
  // colour page still draws in the run colour.
  let isColour = page.mode > 1.5 && input.atlasOrigin.x >= 0.0;
  let painted = select(vec4f(input.color.rgb * alpha, alpha), texel * input.color.a, isColour);
  return painted * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
