/** Canonical placement fields; variants only substitute their absolute origin and axis reads. */
const PLACEMENTS: Readonly<Record<string, readonly [string, string]>> = {
  'sdf-shape': ['input.rect.xy', 'input.axis'],
  'scene-text': ['input.origin', 'input.axis'],
  'frame-title': ['input.origin', 'input.axis'],
  image: ['input.placement.xy', 'input.placement.zw'],
  path: ['input.placement.zw', 'input.placement.xy'],
  'sdf-shape-gradient': ['input.rect.xy', 'input.axis'],
  'sdf-shape-image': ['input.rect.xy', 'input.axis'],
  'path-gradient': ['input.placement.zw', 'input.placement.xy'],
  // Frame backgrounds (a retained move carries frames and their subtrees).
  'solid-rect': ['input.origin', 'input.axis'],
  'rect-gradient': ['input.origin', 'input.axis'],
  // The vector glyph tier's stencil pass: its runs move with their text.
  'glyph-stencil': ['input.placement.zw', 'input.placement.xy'],
  // Its edge hulls, which move with them.
  'glyph-edge': ['input.placement.zw', 'input.placement.xy'],
};

const LOAD_PLACEMENT = `
// Generated retained-move variant. Zero selects the unchanged ordinary instance record.
@group(0) @binding(4) var moveTransforms: texture_2d<f32>;

fn movePlacement(index: f32, fallback: vec4f) -> vec4f {
  if (index == 0.0) { return fallback; }
  let width = textureDimensions(moveTransforms).x;
  let slot = u32(index);
  let placed = textureLoad(moveTransforms, vec2i(i32(slot % width), i32(slot / width)), 0);
  // Texel 0 holds the session's translation (TransformTable.setOffset).
  let offset = textureLoad(moveTransforms, vec2i(0, 0), 0).xy;
  return vec4f(placed.xy + offset, placed.zw);
}

`;

/**
 * Builds an opt-in placement-only variant of a canonical built-in shader. Fragment work and
 * vertex arithmetic stay unchanged; only the source of the already-rounded placement changes.
 * This runs at build time, never in the renderer. Unknown shaders have no implicit opt-in.
 *
 * @param name - Canonical shader name.
 * @param source - Canonical WGSL.
 * @returns Its move variant, or undefined for unsupported shaders.
 * @throws {Error} When a canonical shader no longer has its expected placement expressions.
 */
export function moveShaderSource(name: string, source: string): string | undefined {
  const fields = PLACEMENTS[name];
  if (fields === undefined) return undefined;
  const vertexStart = 'fn vertexMain(input: VertexInput) -> VertexOutput {';
  const vertexOffset = source.indexOf(vertexStart);
  const fragmentOffset = source.indexOf('@fragment');
  const prefix = source.slice(0, vertexOffset);
  const vertex = source.slice(vertexOffset, fragmentOffset);
  const [origin, axis] = fields;
  if (
    vertexOffset < 0 ||
    fragmentOffset < 0 ||
    !vertex.includes(origin) ||
    !vertex.includes(axis)
  ) {
    throw new Error(`The ${name} placement expressions changed; review its move variant.`);
  }
  const substituted = vertex.replaceAll(origin, 'moved.xy').replaceAll(axis, 'moved.zw');
  return (
    prefix.replace(
      'struct VertexInput {',
      `${LOAD_PLACEMENT}struct VertexInput {\n  @location(7) moveIndex: f32,`,
    ) +
    substituted.replace(
      vertexStart,
      `${vertexStart}\n  let moved = movePlacement(input.moveIndex, vec4f(${origin}, ${axis}));`,
    ) +
    source.slice(fragmentOffset)
  );
}
