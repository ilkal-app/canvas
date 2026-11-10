/**
 * A resource declaration in naga-generated GLSL ES 3.00, tied back to its WGSL binding. GLSL ES
 * 3.00 has no `layout(binding = n)`, so the backend binds blocks and samplers by name.
 */
export interface GlslBinding {
  /** A uniform block, or a combined sampler named after the texture it samples. */
  readonly kind: 'uniform-block' | 'sampler';
  /** The GLSL block name (for `getUniformBlockIndex`) or sampler name (for `getUniformLocation`). */
  readonly name: string;
  /** The WGSL `@binding` of the buffer or texture, in group 0. */
  readonly binding: number;
}

/**
 * naga names a uniform block `<Struct>_block_<n><Stage>` and its instance
 * `_group_<g>_binding_<b>_<vs|fs>`; a combined sampler takes the texture's global name.
 */
const UNIFORM_BLOCK_PATTERN =
  /uniform\s+(\w+)\s*\{\s*\w+\s+_group_(\d+)_binding_(\d+)_[a-z]+\s*;\s*\}/g;
const SAMPLER_PATTERN =
  /uniform\s+(?:(?:highp|mediump|lowp)\s+)?sampler2D\s+(_group_(\d+)_binding_(\d+)_[a-z]+)\s*;/g;

/**
 * Lists the uniform blocks and samplers a naga-generated GLSL stage declares, with the WGSL
 * binding each came from.
 *
 * @param glsl - One generated GLSL ES 3.00 stage.
 * @returns Its uniform blocks, then its samplers, in declaration order.
 * @throws {RangeError} When a resource lives outside WGSL group 0.
 */
export function parseGlslBindings(glsl: string): GlslBinding[] {
  const blocks = [...glsl.matchAll(UNIFORM_BLOCK_PATTERN)].map((match) =>
    toBinding('uniform-block', match),
  );
  const samplers = [...glsl.matchAll(SAMPLER_PATTERN)].map((match) => toBinding('sampler', match));
  return [...blocks, ...samplers];
}

function toBinding(kind: GlslBinding['kind'], match: RegExpMatchArray): GlslBinding {
  const [, name = '', group = '', binding = ''] = match;
  if (group !== '0') {
    throw new RangeError(`${name} is in WGSL group ${group}; only group 0 is supported.`);
  }
  return { kind, name, binding: Number(binding) };
}
