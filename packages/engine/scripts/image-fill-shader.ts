// The image-fill variant of the SDF shape shader: the same vertex
// placement, SDF, corner radius, outline and coverage as the solid source, with the fill colour
// taken from an image page at the fragment's point of the object's box, laid in by the paint's
// fit (`imagePaintLayout` in @canvas/schema). Generated at build time from the solid source, so
// the two can never drift; the solid shader itself is unchanged.

/**
 * The page bindings and the fill in WGSL. The bindings are the image pass's
 * (`IMAGE_TEXTURE_BINDING`, `IMAGE_SAMPLER_BINDING`); the move variant's table is at 4 and the
 * clip table at 5.
 */
const IMAGE_FUNCTIONS = `
// Generated image-fill variant (scripts/image-fill-shader.ts): the level's page and its sampler.
@group(0) @binding(1) var pageTexture: texture_2d<f32>;
@group(0) @binding(2) var pageSampler: sampler;

// The crop's virtual texel \`index\` (any integer) wrapped into the crop, at its centre on the
// page, clamped into the region the samples stay in. The crop, \`span\` page texels wide from
// \`start\` (fractional off the texel grid), is divided into \`count\` = ceil(span) equal virtual
// texels: for a whole crop on the grid they are its texels, centre for centre; off the grid the
// sampler interpolates at their centres. The index wraps by the integer count, so the tile's
// filter is periodic and continuous across its edges whatever the span.
fn cropTap(index: vec2f, count: vec2f, start: vec2f, span: vec2f, dims: vec2f, low: vec2f, high: vec2f) -> vec2f {
  let wrapped = index - count * floor(index / count);
  return clamp((start + (wrapped + vec2f(0.5)) * span / count) / dims, low, high);
}

// The fill's premultiplied colour at a point of the drawn rectangle: \`t\` runs 0 to 1 across one
// copy of the crop (imagePaintLayout's \`drawn\`), \`uvRect\` maps it to the page, \`clampRect\` is
// the page region samples stay in (half a texel inside, so an atlas neighbour never bleeds).
// \`weights\`: (texture weight, mode, cell width, cell height); mode 0 clamps (fill, crop), 1
// letterboxes (fit: nothing outside the drawn rectangle, its edge antialiased over one device
// pixel where it lies inside the box), 2 repeats (tile). A weight of 0 draws the placeholder
// colour (\`solid\`, straight alpha): a level not yet resident, or the average-colour form.
// Repeat filters by hand: the sampler clamps at the page region (atlas entries have no gutter),
// so it blends the four virtual texels of the crop round the point (\`cropTap\`), wrapped by
// index: a tile's last column blends into the next tile's first with no seam at any zoom or turn,
// and a crop off the texel grid keeps its detail and its period.
fn imageFill(
  t: vec2f,
  uvRect: vec4f,
  clampRect: vec4f,
  weights: vec4f,
  solid: vec4f,
  halfSize: vec2f,
  pixel: f32,
) -> vec4f {
  let placeholder = vec4f(solid.rgb * solid.a, solid.a);
  let dims = vec2f(textureDimensions(pageTexture));
  let halfTexel = vec2f(0.5) / dims;
  let low = clampRect.xy + halfTexel;
  let high = max(low, clampRect.zw - halfTexel);
  var texel: vec4f;
  if (weights.y > 1.5) {
    let start = uvRect.xy * dims;
    let span = max((uvRect.zw - uvRect.xy) * dims, vec2f(1e-3));
    let count = max(ceil(span - vec2f(1e-3)), vec2f(1.0));
    let at = fract(t) * count - vec2f(0.5);
    let first = floor(at);
    let blend = at - first;
    let a = cropTap(first, count, start, span, dims, low, high);
    let b = cropTap(first + vec2f(1.0), count, start, span, dims, low, high);
    let top = mix(
      textureSampleLevel(pageTexture, pageSampler, a, 0.0),
      textureSampleLevel(pageTexture, pageSampler, vec2f(b.x, a.y), 0.0),
      blend.x,
    );
    let bottom = mix(
      textureSampleLevel(pageTexture, pageSampler, vec2f(a.x, b.y), 0.0),
      textureSampleLevel(pageTexture, pageSampler, b, 0.0),
      blend.x,
    );
    texel = mix(top, bottom, blend.y);
  } else {
    let uv = clamp(mix(uvRect.xy, uvRect.zw, clamp(t, vec2f(0.0), vec2f(1.0))), low, high);
    texel = textureSampleLevel(pageTexture, pageSampler, uv, 0.0);
  }
  let color = mix(placeholder, texel, weights.x);
  if (weights.y > 0.5 && weights.y < 1.5) {
    // Letterbox: on an axis where the drawn rectangle is narrower than the box, coverage falls
    // off over one device pixel at its edges; where it spans the box, the shape's edge does.
    let cell = weights.zw;
    let inside = (vec2f(0.5) - abs(t - vec2f(0.5))) * cell;
    let ramp = clamp(inside / max(pixel, 1e-6) + vec2f(0.5), vec2f(0.0), vec2f(1.0));
    let isNarrower = cell < 2.0 * halfSize - vec2f(1e-3);
    let mask = select(vec2f(1.0), ramp, isNarrower);
    return color * mask.x * mask.y;
  }
  return color;
}

`;

/** One substitution: the text it expects in the solid source and what replaces it. */
type Substitution = readonly [string, string];

/** The image-fill instance attributes, after the SDF shape's (and the move variant's 7). */
const IMAGE_INPUTS =
  'struct VertexInput {\n  @location(8) uvRect: vec4f,\n  @location(9) clampRect: vec4f,\n  @location(10) imageFit: vec4f,\n  @location(11) imageWeights: vec2f,';

/** The image-fill varyings, after the SDF shape's `pixel` (locations 12 and 13 are the clip's). */
const IMAGE_OUTPUTS =
  '  @location(7) @interpolate(flat) pixel: f32,\n  @location(8) imageT: vec2f,\n  @location(9) @interpolate(flat) uvRect: vec4f,\n  @location(10) @interpolate(flat) clampRect: vec4f,\n  @location(11) @interpolate(flat) imageWeights: vec4f,\n}';

/**
 * The vertex stage's image values: the unit-box point mapped through the fit (`imageFit`: the box
 * over the drawn rectangle, then the drawn rectangle's offset over its size) to `t`, and the
 * drawn rectangle's size (the box over `imageFit.xy`) for the letterbox's edge. Reads only the
 * record's size, never its origin or axis, which the move variant rewrites.
 */
const IMAGE_VERTEX = [
  '  output.pixel = camera.pixel;',
  '  let unitBox = select(output.local / size + 0.5, vec2f(0.5), size == vec2f(0.0));',
  '  output.imageT = unitBox * input.imageFit.xy + input.imageFit.zw;',
  '  output.uvRect = input.uvRect;',
  '  output.clampRect = input.clampRect;',
  '  output.imageWeights = vec4f(input.imageWeights, size / max(input.imageFit.xy, vec2f(1e-6)));',
].join('\n');

/** The SDF shape source's substitutions, each an expression it must hold exactly once. */
const EDITS: readonly Substitution[] = [
  ['struct VertexInput {', IMAGE_INPUTS],
  ['  @location(7) @interpolate(flat) pixel: f32,\n}', IMAGE_OUTPUTS],
  ['  output.pixel = camera.pixel;', IMAGE_VERTEX],
  [
    '  let fillAlpha = input.color.a * outer;',
    '  let paint = imageFill(input.imageT, input.uvRect, input.clampRect, input.imageWeights, input.color, halfSize, input.pixel);\n  let fillAlpha = paint.a * outer;',
  ],
  ['input.color.rgb * fillAlpha * fillShown', 'paint.rgb * outer * fillShown'],
];

/** The one solid source with an image-fill variant, and the variant's name. */
const VARIANTS: Readonly<Record<string, string>> = { 'sdf-shape': 'sdf-shape-image' };

/**
 * The image-fill variant a solid source has, if any.
 *
 * @param name - The solid shader's name.
 * @returns The variant's name, or undefined.
 */
export function imageFillVariantName(name: string): string | undefined {
  return VARIANTS[name];
}

/**
 * Builds the image-fill variant of the SDF shape shader at build time: the page's bindings and
 * `imageFill` before its vertex input, the image attributes as instance locations 8 to 11, and
 * the fill's colour from the page. Everything else (the SDF, the radius, the outline over the
 * fill, the clip coverage) is the solid source's.
 *
 * @param name - The solid shader's name.
 * @param source - Its WGSL.
 * @returns The variant's WGSL, or undefined for a shader without one.
 * @throws {Error} When the solid source no longer holds an expected expression exactly once.
 */
export function imageFillShaderSource(name: string, source: string): string | undefined {
  if (VARIANTS[name] === undefined) return undefined;
  let variant = source;
  for (const [expected, replacement] of EDITS) {
    const first = variant.indexOf(expected);
    if (first < 0 || variant.includes(expected, first + expected.length)) {
      throw new Error(
        `${name}.wgsl must hold \`${expected}\` exactly once for its image-fill variant`,
      );
    }
    variant = variant.replace(expected, replacement);
  }
  const at = variant.indexOf('struct VertexInput {');
  return `${variant.slice(0, at)}${IMAGE_FUNCTIONS}${variant.slice(at)}`;
}
