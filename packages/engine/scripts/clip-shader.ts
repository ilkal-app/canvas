// Frame clipping for the scene shaders: the clip table's binding and the functions
// every scene pass's canonical shader calls, `clipVertex` and `layerAlpha` in its vertex stage
// and `clipCoverage` in its fragment stage, included at build time before the shader's vertex
// input so the six sources never drift. Clipping is analytic: the fragment's coverage is
// multiplied in, never discarded, so the path pass's stencil operations still run where it is
// clipped. A record's layer opacity (multiply form) is multiplied in with it: the
// record's trailing transparency (`InstanceLayout.opacityFloat`), 0 for an opaque object, gives
// an alpha of exactly 1, so an opaque board draws exactly as before.

/**
 * The clip table and its functions in WGSL. The table (`packages/engine/src/scene/clip-table.ts`)
 * holds four texels per clipping frame: its world origin and axis; its size, its clipping
 * ancestor's slot and whether its corners are rounded; its frame in that ancestor's, as (cos,
 * sin, tx, ty); its four capped corner radii. Slot 0 is unclipped.
 */
export const CLIP_FUNCTIONS = `
// Included by scripts/clip-shader.ts: the scene's clip table, four texels per
// clipping frame (packages/engine/src/scene/clip-table.ts), read row-major by texel index.
@group(0) @binding(5) var clipTable: texture_2d<f32>;

// How many clipping frames clip a fragment at most, innermost first (MAX_CLIP_DEPTH).
const MAX_CLIP_DEPTH = 8u;

fn clipTexel(slot: u32, texel: u32) -> vec4f {
  let index = slot * 4u + texel;
  let width = textureDimensions(clipTable).x;
  return textureLoad(clipTable, vec2i(i32(index % width), i32(index / width)), 0);
}

// The vertex stage's half: the vertex in its clip's own frame (xy) and in that clip's clipping
// ancestor's (zw), both affine in the world so they interpolate exactly, and, flat, the clip's
// (width, height, ancestor slot, one device pixel in world units). A pixel of 0 is unclipped. A
// clip with rounded corners gives minus its own slot for the ancestor's, so the
// fragment stage reads its radii and its ancestor from the table; a sharp one draws as before.
struct ClipVertex {
  local: vec4f,
  frame: vec4f,
}

fn clipVertex(world: vec2f, index: f32, pixel: f32) -> ClipVertex {
  var result: ClipVertex;
  result.local = vec4f(0.0);
  result.frame = vec4f(0.0);
  if (index < 0.5) {
    return result;
  }
  let slot = u32(index);
  let placement = clipTexel(slot, 0u);
  let box = clipTexel(slot, 1u);
  let toParent = clipTexel(slot, 2u);
  let offset = world - placement.xy;
  let local = vec2f(
    placement.z * offset.x + placement.w * offset.y,
    placement.z * offset.y - placement.w * offset.x,
  );
  let parent = vec2f(
    toParent.x * local.x - toParent.y * local.y,
    toParent.y * local.x + toParent.x * local.y,
  ) + toParent.zw;
  result.local = vec4f(local, parent);
  result.frame = vec4f(box.xy, select(box.z, -f32(slot), box.w > 0.5), max(pixel, 1e-30));
  return result;
}

// How far a point lies outside the box [0, size] of its frame: negative inside.
fn clipBoxDistance(p: vec2f, size: vec2f) -> f32 {
  let outside = max(-p, p - size);
  return max(outside.x, outside.y);
}

// How far a point lies outside the box [0, size] of its frame whose corners are rounded by
// radii (top-left, top-right, bottom-right, bottom-left): the exact rounded-box
// distance, each corner by its own radius, negative inside.
fn clipRoundedDistance(p: vec2f, size: vec2f, radii: vec4f) -> f32 {
  let half = size * 0.5;
  let q = p - half;
  let left = select(radii.w, radii.x, q.y < 0.0);
  let right = select(radii.z, radii.y, q.y < 0.0);
  let radius = select(right, left, q.x < 0.0);
  let d = abs(q) - half + radius;
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - radius;
}

// A record's layer opacity from its trailing transparency (1 minus the opacity, so
// an all-zero record is opaque), for the vertex stage to hand the fragment stage flat.
fn layerAlpha(transparency: f32) -> f32 {
  return saturate(1.0 - transparency);
}

// The fragment stage's half: the largest box distance over the chain, the first two levels
// from the interpolated points and the rest mapped up the table, antialiased over one device
// pixel like an SDF edge (clipCoverageAt). A rounded clip's level is its rounded-box distance,
// its radii read from the table. Times the layer opacity (layerAlpha).
// Multiply it into the premultiplied output.
fn clipCoverage(local: vec4f, frame: vec4f, alpha: f32) -> f32 {
  if (frame.w <= 0.0) {
    return alpha;
  }
  var distance: f32;
  var slot: u32;
  if (frame.z < 0.0) {
    let own = u32(-frame.z);
    distance = clipRoundedDistance(local.xy, frame.xy, clipTexel(own, 3u));
    slot = u32(clipTexel(own, 1u).z);
  } else {
    distance = clipBoxDistance(local.xy, frame.xy);
    slot = u32(frame.z);
  }
  var ancestorPoint = local.zw;
  for (var level = 1u; level < MAX_CLIP_DEPTH; level++) {
    if (slot == 0u) {
      break;
    }
    let box = clipTexel(slot, 1u);
    var levelDistance = clipBoxDistance(ancestorPoint, box.xy);
    if (box.w > 0.5) {
      levelDistance = clipRoundedDistance(ancestorPoint, box.xy, clipTexel(slot, 3u));
    }
    distance = max(distance, levelDistance);
    let next = u32(box.z);
    if (next != 0u) {
      let toParent = clipTexel(slot, 2u);
      ancestorPoint = vec2f(
        toParent.x * ancestorPoint.x - toParent.y * ancestorPoint.y,
        toParent.y * ancestorPoint.x + toParent.x * ancestorPoint.y,
      ) + toParent.zw;
    }
    slot = next;
  }
  return saturate(0.5 - distance / frame.w) * alpha;
}

`;

/** The canonical shaders that clip: every scene pass's. */
const CLIPPED_SHADERS: ReadonlySet<string> = new Set([
  'solid-rect',
  'sdf-shape',
  'image',
  'path',
  'scene-text',
  'frame-title',
  'path-batch',
  // The vector glyph tier's edge hulls: they paint, so they clip and fade.
  'glyph-edge',
]);

/**
 * What a clipped canonical shader must contain, so a scene shader cannot drop its clip or its
 * layer opacity.
 */
const REQUIRED = [
  '@location(14) clipIndex: f32',
  '@location(12) layerTransparency: f32',
  'clipVertex(world, input.clipIndex, camera.pixel)',
  'clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)',
] as const;

/**
 * The same for a shader that reads its record from a texture instead of instance attributes
 * (the batched path strokes, path-batch.wgsl).
 */
const PULLED_REQUIRED = [
  'clipVertex(world, record.clipIndex, camera.pixel)',
  'clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)',
] as const;

/** The shaders that read their records from a texture (see {@link PULLED_REQUIRED}). */
const PULLED_SHADERS: ReadonlySet<string> = new Set(['path-batch']);

/**
 * What a scene shader whose records fade with their layer must contain: every one but
 * the frame title's, since a frame's name is not part of its layer.
 */
const FADED = 'output.layerAlpha = layerAlpha(input.layerTransparency)';
const PULLED_FADED = 'output.layerAlpha = layerAlpha(record.layerTransparency)';

/** The canonical scene shaders whose records never fade: a frame's name. */
const UNFADED_SHADERS: ReadonlySet<string> = new Set(['frame-title']);

/**
 * Whether a canonical shader clips: the scene passes' shaders do.
 *
 * @param name - The canonical shader's name.
 * @returns True for a scene pass's shader.
 */
export function isClippedShader(name: string): boolean {
  return CLIPPED_SHADERS.has(name);
}

/**
 * Includes the clip table's binding and functions in a canonical scene shader, before its
 * vertex input, at build time; the gradient and retained-move variants are derived from the
 * result, so they clip alike. Other shaders are returned unchanged.
 *
 * @param name - The canonical shader's name.
 * @param source - Its WGSL.
 * @returns The WGSL to build from.
 * @throws {Error} When a scene shader no longer reads its clip index or applies its coverage, or
 *   (but for the frame title's) no longer fades with its layer.
 */
export function clipShaderSource(name: string, source: string): string {
  if (!CLIPPED_SHADERS.has(name)) return source;
  const isPulled = PULLED_SHADERS.has(name);
  for (const expected of isPulled ? PULLED_REQUIRED : REQUIRED) {
    if (!source.includes(expected)) {
      throw new Error(`The ${name} shader no longer clips (${expected}); review.`);
    }
  }
  const faded = isPulled ? PULLED_FADED : FADED;
  if (!UNFADED_SHADERS.has(name) && !source.includes(faded)) {
    throw new Error(`The ${name} shader no longer fades (${faded}); review.`);
  }
  return source.replace('struct VertexInput {', `${CLIP_FUNCTIONS}struct VertexInput {`);
}
