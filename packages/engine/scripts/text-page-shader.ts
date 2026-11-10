// The scene text shader's page-count variants: the same shader with its per-glyph
// page switch cut to the first 1, 2 or 4 slots of the page group. A switch over the group's page
// textures costs fragment time with the number of its cases, whichever page the glyphs are on
// (the mobile CJK zoom sweep: 5.1 ms of GPU a frame with eight, 1.45 with none, on an M1 Max), so
// a group whose pages fill only its first slots draws with the variant that covers them. The
// bindings stay the group's, so one bind group layout serves every variant. Generated at build
// time from scene-text.wgsl, so the variants can never drift from it.

/** The page counts a variant is generated for; the full group draws with the shader itself. */
export const TEXT_PAGE_VARIANT_SLOTS: readonly number[] = [1, 2, 4];

/** The shader the variants are cut from. */
const SOURCE = 'scene-text';

/** The vertex stage's page index: the line a variant follows with its slot guard. */
const PAGE_INDEX_LINE = '  output.pageIndex = u32(clamp(round(input.pageIndex), 0.0, 7.0));';

/** The switch the fragment stage picks a page with, from its first case to its default. */
const SWITCH =
  /( {2}switch index \{\n)((?: {4}case \d+u: \{[^\n]*\}\n)+)( {4}default: \{ return textureLoad\(atlasTexture0, texel, 0\); \}\n {2}\})/;

/**
 * A variant's name, for a source that has variants.
 *
 * @param name - The source shader's name.
 * @param slots - The slots the variant covers.
 * @returns The variant's name (`scene-text-pages-2`), or undefined for another shader.
 */
export function textPageVariantName(name: string, slots: number): string | undefined {
  return name === SOURCE ? `${SOURCE}-pages-${String(slots)}` : undefined;
}

/**
 * The WGSL of a page-count variant: the page switch keeps the cases below `slots` (none for one
 * slot), and a record naming a slot past them is dropped in the vertex stage (moved outside the
 * clip volume), so it draws nothing, as it would from a free slot's blank page, instead of
 * sampling page 0.
 *
 * @param name - The source shader's name.
 * @param wgsl - Its WGSL, with the clip shader included.
 * @param slots - The slots the variant covers.
 * @returns The variant's WGSL, or undefined for a shader without variants.
 * @throws {Error} When the source no longer has the page switch or the page index line.
 */
export function textPageVariantSource(
  name: string,
  wgsl: string,
  slots: number,
): string | undefined {
  if (name !== SOURCE) return undefined;
  const match = SWITCH.exec(wgsl);
  if (match === null || !wgsl.includes(PAGE_INDEX_LINE)) {
    throw new Error(`text-page-shader: ${SOURCE}.wgsl no longer has the page switch it rewrites.`);
  }
  const [whole, , cases = ''] = match;
  const kept = cases
    .split('\n')
    .filter((line) => {
      const slot = /case (\d+)u/.exec(line)?.[1];
      return slot !== undefined && Number(slot) < slots;
    })
    .map((line) => `${line}\n`)
    .join('');
  const loads =
    slots === 1 ? '  return textureLoad(atlasTexture0, texel, 0);' : whole.replace(cases, kept);
  const guard =
    `${PAGE_INDEX_LINE}\n` +
    `  // Generated page-count variant (scripts/text-page-shader.ts): slots 0 to ${String(slots - 1)}.\n` +
    `  if (output.pageIndex >= ${String(slots)}u) {\n` +
    '    output.position = vec4f(0.0, 0.0, 2.0, 1.0);\n' +
    '  }';
  return wgsl.replace(whole, loads).replace(PAGE_INDEX_LINE, guard);
}
