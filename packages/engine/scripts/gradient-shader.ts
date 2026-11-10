// The gradient variants of the solid fill shaders: the same vertex placement,
// SDF and coverage as their solid source, with the fill colour taken from the scene's paint table
// at the fragment's point of the object's unit box. Generated at build time from the solid
// source, so the two can never drift; the solid shaders themselves are unchanged.

/**
 * The paint table's binding and `paintColorAt` in WGSL, premultiplied: the record layout of
 * `packGradientRecord` (packages/engine/src/paint/gradient-record.ts) at the record index the
 * instance carries; index 0 draws the instance's own straight-alpha colour.
 */
const PAINT_FUNCTIONS = `
// Generated gradient variant (scripts/gradient-shader.ts): the scene's paint table, one 11-texel
// record per gradient (packages/engine/src/paint/gradient-record.ts), 64 records per row.
@group(0) @binding(1) var paintTable: texture_2d<f32>;

fn paintTexel(record: u32, texel: u32) -> vec4f {
  let x = (record % 64u) * 11u + texel;
  return textureLoad(paintTable, vec2i(i32(x), i32(record / 64u)), 0);
}

// paintColorAt (packages/schema/src/fields/paint.ts), premultiplied: the position along the
// gradient (linear: projected on the direction, which the header holds already divided by
// |cos| + |sin|; radial: the distance from the centre times 1 / radius), padded to the first and
// last offsets, interpolated linearly between neighbouring premultiplied stops; at equal offsets
// the later stop applies.
fn paintAt(record: u32, unit: vec2f) -> vec4f {
  let header = paintTexel(record, 0u);
  var t = length(unit - header.yz) * header.w;
  if (header.x < 0.5) {
    t = 0.5 + (unit.x - 0.5) * header.y + (unit.y - 0.5) * header.z;
  }
  let low = paintTexel(record, 9u);
  let high = paintTexel(record, 10u);
  var offsets = array<f32, 8>(low.x, low.y, low.z, low.w, high.x, high.y, high.z, high.w);
  var before = paintTexel(record, 1u);
  if (offsets[0] > t) {
    return before;
  }
  for (var index = 1u; index < 8u; index++) {
    let stop = paintTexel(record, 1u + index);
    let offset = offsets[index];
    if (offset > t) {
      let previous = offsets[index - 1u];
      return mix(before, stop, (t - previous) / (offset - previous));
    }
    before = stop;
  }
  return before;
}

// The fill's premultiplied colour: the record's paint at the unit-box point, or record 0's
// straight-alpha colour (a gradient drawn as its average colour).
fn paintFill(row: f32, solid: vec4f, unit: vec2f) -> vec4f {
  if (row < 0.5) {
    return vec4f(solid.rgb * solid.a, solid.a);
  }
  return paintAt(u32(row), unit);
}

`;

/** One substitution: the text it expects in the solid source and what replaces it. */
type Substitution = readonly [string, string];

/** The clip coverage every scene shader multiplies its output by (`clip-shader.ts`). */
const CLIP_COVERAGE = 'clipCoverage(input.clipLocal, input.clipFrame, input.layerAlpha)';

const SOLID_FRAGMENT_RETURN = `return vec4f(input.color.rgb * input.color.a, input.color.a) * ${CLIP_COVERAGE};`;

/** The paint row's instance attribute, after the move variant's `@location(7)`. */
const PAINT_ROW_INPUT = 'struct VertexInput {\n  @location(8) paintRow: f32,';

/** Each solid source's variant name and substitutions. */
const VARIANTS: Readonly<
  Record<string, { readonly name: string; readonly edits: readonly Substitution[] }>
> = {
  'sdf-shape': {
    name: 'sdf-shape-gradient',
    edits: [
      ['struct VertexInput {', PAINT_ROW_INPUT],
      [
        '  @location(7) @interpolate(flat) pixel: f32,\n}',
        '  @location(7) @interpolate(flat) pixel: f32,\n  @location(8) @interpolate(flat) paintRow: f32,\n}',
      ],
      [
        '  output.pixel = camera.pixel;',
        '  output.pixel = camera.pixel;\n  output.paintRow = input.paintRow;',
      ],
      [
        '  let fillAlpha = input.color.a * outer;',
        '  let unit = select(input.local / (2.0 * input.halfSize) + 0.5, vec2f(0.5), input.halfSize == vec2f(0.0));\n  let paint = paintFill(input.paintRow, input.color, unit);\n  let fillAlpha = paint.a * outer;',
      ],
      ['input.color.rgb * fillAlpha * fillShown', 'paint.rgb * outer * fillShown'],
    ],
  },
  path: {
    name: 'path-gradient',
    edits: [
      ['struct VertexInput {', PAINT_ROW_INPUT],
      [
        '  @location(0) color: vec4f,\n}',
        '  @location(0) color: vec4f,\n  @location(1) local: vec2f,\n  @location(2) @interpolate(flat) box: vec4f,\n  @location(3) @interpolate(flat) paintRow: f32,\n}',
      ],
      [
        '  output.color = input.color;',
        '  output.color = input.color;\n  output.local = input.position;\n  output.box = input.color;\n  output.paintRow = input.paintRow;',
      ],
      [
        SOLID_FRAGMENT_RETURN,
        '// A fill record holds its paint box (min x, min y, 1 / width, 1 / height; 0 for an axis of\n  // zero extent, which maps to 0.5) where a stroke holds its colour.\n  let unit = select((input.local - input.box.xy) * input.box.zw, vec2f(0.5), input.box.zw == vec2f(0.0));\n  return paintFill(input.paintRow, input.color, unit) * ' +
          `${CLIP_COVERAGE};`,
      ],
    ],
  },
  'solid-rect': {
    name: 'rect-gradient',
    edits: [
      ['struct VertexInput {', PAINT_ROW_INPUT],
      [
        '  @location(0) color: vec4f,\n}',
        '  @location(0) color: vec4f,\n  @location(1) unit: vec2f,\n  @location(2) @interpolate(flat) paintRow: f32,\n}',
      ],
      [
        '  output.color = input.color;',
        '  output.color = input.color;\n  output.unit = input.corner;\n  output.paintRow = input.paintRow;',
      ],
      [
        SOLID_FRAGMENT_RETURN,
        `return paintFill(input.paintRow, input.color, input.unit) * ${CLIP_COVERAGE};`,
      ],
    ],
  },
};

/**
 * The gradient variant a solid source has, if any.
 *
 * @param name - The solid shader's name.
 * @returns The variant's name, or undefined.
 */
export function gradientVariantName(name: string): string | undefined {
  return VARIANTS[name]?.name;
}

/**
 * Builds the gradient variant of a solid fill shader at build time: the paint table's binding
 * and functions before its vertex input, the paint row as instance attribute 8, and the fill's
 * colour from the paint. Everything else, the SDF and coverage included, is the solid source's.
 *
 * @param name - The solid shader's name.
 * @param source - Its WGSL.
 * @returns The variant's WGSL, or undefined for a shader without one.
 * @throws {Error} When the solid source no longer has an expected expression.
 */
export function gradientShaderSource(name: string, source: string): string | undefined {
  const variant = VARIANTS[name];
  if (variant === undefined) return undefined;
  let wgsl = source.replace('struct VertexInput {', `${PAINT_FUNCTIONS}struct VertexInput {`);
  for (const [from, to] of variant.edits) {
    if (!wgsl.includes(from)) {
      throw new Error(`The ${name} shader changed (${from.trim()}); review its gradient variant.`);
    }
    wgsl = wgsl.replace(from, to);
  }
  return wgsl;
}
