// The frame title pass (packages/engine/src/text/scene/frame-title-pass.ts): each
// frame's name drawn above its top edge at a constant size on screen. The scene text shader
// (scene-text.wgsl) with one change: a glyph's rectangle is in CSS pixels from the frame's
// top-left corner, and is scaled into the frame's frame by the size of one CSS pixel in world
// units (the camera uniform's `cssPixel`), so the name turns with the frame but does not grow or
// shrink with the zoom, and a zoom uploads nothing. This file is the single source:
// the engine's `shaders` script generates the GLSL ES 3.0 stages and
// frame-title.generated.ts from it.

// Frame clipping: `clipVertex`, `clipCoverage` and the clip table at `@binding(5)` are
// included by scripts/clip-shader.ts; the coverage is multiplied in, never discarded.
// Layer opacity: `layerAlpha` is included there too, and `clipCoverage` multiplies the
// record's opacity into the coverage.

// The engine's camera uniform, shared by every pass: clip = world * scale + offset
// (packages/engine/src/camera/camera.ts, cameraClipTransform), then the size of one device
// pixel in world units (packages/engine/src/scene/camera-uniform.ts), which a greek bar's
// antialiasing reads, then the size of one CSS pixel in world units (1 / zoom).
struct Camera {
  scale: vec2f,
  offset: vec2f,
  pixel: f32,
  cssPixel: f32,
  padding1: f32,
  padding2: f32,
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

// Stem darkening: text small enough to draw from the 64 px/em tier gains up to 0.15 device
// px of weight, full at or below 12 px/em and fading out by 24 px/em, so gamma-correct edges do not
// thin small text (the platforms darken stems the same way).
const STEM_DARKEN_PX: f32 = 0.15;
const DARKEN_FADE_EM_PX: f32 = 12.0;
const DARKEN_END_EM_PX: f32 = 24.0;
const SMALL_TIER_EM_TEXELS: f32 = 64.0;

// A name never runs past its frame's right edge: it is cut there, antialiased over the
// device pixel at the edge, so a frame zoomed out narrower than its name shows the name's start,
// and a name that fits is drawn as it was.

struct VertexInput {
  // Per vertex: the corner of the unit quad.
  @location(0) corner: vec2f,
  // Per instance: the object's local origin in world units and its world rotation as
  // (cos, sin).
  @location(1) origin: vec2f,
  @location(2) axis: vec2f,
  // Per instance: the glyph's bitmap rectangle (x, y, width, height) from the frame's top-left
  // corner along its axes, CSS px, y down. A zero rectangle (a released or pending record) draws
  // nothing.
  @location(3) rect: vec4f,
  // Per instance: the bitmap's rectangle in the page (u0, v0, u1, v1); all -1 for a greek bar
  // (text under 4 device px a line), which draws in its colour, its top and bottom edges
  // antialiased.
  @location(4) uvRect: vec4f,
  // Per instance: the glyph's straight-alpha colour.
  @location(5) color: vec4f,
  // Per instance: the frame's width, world units, where its name ends (the frame title pass's
  // `recordValueOf`; the slot the scene text shader reads its page index from).
  @location(6) frameWidth: f32,
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
  @location(1) color: vec4f,
  // For a greek bar: where the fragment is across the bar's height and the height, both in
  // device pixels from the bar's top edge; unused by a glyph.
  @location(2) bar: vec2f,
  // How far the fragment is along the frame's top edge and how wide the frame is, both in device
  // pixels.
  @location(3) edge: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  // A name is hidden, not greeked, when its frame is small on screen, but a greek record is
  // still drawn as the text pass draws one: its quad grows by a device pixel above and below.
  let isBar = input.uvRect.x < 0.0;
  let pad = select(0.0, camera.pixel / camera.cssPixel, isBar);
  let height = input.rect.w + 2.0 * pad;
  let cssLocal = vec2f(input.rect.x, input.rect.y - pad) + input.corner * vec2f(input.rect.z, height);
  let local = cssLocal * camera.cssPixel;
  let world = input.origin + vec2f(
    input.axis.x * local.x - input.axis.y * local.y,
    input.axis.y * local.x + input.axis.x * local.y,
  );
  var output: VertexOutput;
  output.position = vec4f(world * camera.scale + camera.offset, 0.0, 1.0);
  let clipped = clipVertex(world, input.clipIndex, camera.pixel);
  output.clipLocal = clipped.local;
  output.clipFrame = clipped.frame;
  // A frame's name is not part of its layer: it never fades, as Figma's does not. At a
  // cumulative opacity of 0 (the frame's own or an ancestor's: the multiply form's product, the
  // record's transparency 1) it is hidden with its frame; layered frames are
  // left out by the z-order segments' invisible ranks instead.
  output.layerAlpha = select(1.0, 0.0, input.layerTransparency >= 1.0);
  output.uv = mix(input.uvRect.xy, input.uvRect.zw, input.corner);
  output.color = input.color;
  output.bar = vec2f(input.corner.y * height - pad, input.rect.w) * camera.cssPixel / camera.pixel;
  output.edge = vec2f(cssLocal.x, input.frameWidth / camera.cssPixel) * camera.cssPixel / camera.pixel;
  return output;
}

fn median3(sample: vec3f) -> f32 {
  return max(min(sample.r, sample.g), min(max(sample.r, sample.g), sample.b));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texel = textureSample(atlasTexture, atlasSampler, input.uv);
  // Mode 1 is a single-channel page; a colour page (mode 2) is not one.
  let field = select(median3(texel.rgb), texel.r, abs(page.isSingleChannel - 1.0) < 0.5);
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
  let coverage = select(glyphCoverage, barCoverage, input.uv.x < 0.0);
  // The canvas blends sRGB-encoded values: the coverage is corrected so the text blends as in
  // linear light (scripts/coverage-gamma-shader.ts).
  let corrected = gammaCorrectedCoverage(coverage, input.color.rgb);
  let alpha = input.color.a * corrected;
  // Cut at the frame's right edge: the share of this device pixel inside it.
  let inside = clamp(input.edge.y - input.edge.x + 0.5, 0.0, 1.0);
  return vec4f(input.color.rgb * alpha, alpha) * inside * clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha);
}
