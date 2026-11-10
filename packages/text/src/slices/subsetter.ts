// Font subsetting with HarfBuzz's own WebAssembly build of hb-subset (harfbuzzjs's
// `harfbuzz-subset.wasm`): a font file cut down to some characters, its layout tables
// kept for the glyphs that remain. The caller passes the wasm's bytes, so the package reads no file.

/* eslint-disable @typescript-eslint/naming-convention -- hb-subset's C export names */
/** The hb-subset exports this module calls. */
interface SubsetExports {
  readonly memory: { readonly buffer: ArrayBuffer };
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** The part of the WebAssembly API this module uses: the package's `lib` is ES2022 alone. */
interface WebAssemblyApi {
  instantiate(
    wasm: ArrayBuffer | ArrayBufferView,
  ): Promise<{ readonly instance: { readonly exports: unknown } }>;
}

/** HarfBuzz's memory mode for a blob it may write: `HB_MEMORY_MODE_WRITABLE`. */
const WRITABLE = 2;

/** hb-subset's `HB_SUBSET_FLAGS_RETAIN_GIDS`: glyphs keep their ids. */
const RETAIN_GIDS = 0x2;

/** Cuts font files down to some characters (`createSubsetter`). */
export interface Subsetter {
  /**
   * A font file that maps only the given characters the font maps, with the glyphs they need and
   * the layout tables (GSUB, GPOS) for those glyphs.
   *
   * @param font - The font file (a single face, not a collection).
   * @param codepoints - The characters to keep.
   * @param options - How to subset.
   * @param options.isRetainingGlyphIds - Whether every glyph keeps its id, the dropped ones left
   *   empty (a PDF names glyphs by the ids the text was shaped with); false by default.
   * @returns The subset font file.
   * @throws {Error} When HarfBuzz cannot read or subset the font.
   */
  subset(
    font: Uint8Array,
    codepoints: Iterable<number>,
    options?: { readonly isRetainingGlyphIds?: boolean },
  ): Uint8Array;
}

/**
 * Instantiates hb-subset.
 *
 * @param wasm - The bytes of harfbuzzjs's `harfbuzz-subset.wasm`.
 * @returns The subsetter.
 */
export async function createSubsetter(wasm: ArrayBuffer | ArrayBufferView): Promise<Subsetter> {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
  const api = (globalThis as unknown as { readonly WebAssembly: WebAssemblyApi }).WebAssembly;
  const { instance } = await api.instantiate(wasm);
  const hb = instance.exports as SubsetExports;
  return {
    subset: (font, codepoints, options) => {
      // Read the characters first: nothing is allocated if their iterator throws.
      const kept = [...codepoints];
      const data = hb.malloc(font.byteLength);
      try {
        new Uint8Array(hb.memory.buffer).set(font, data);
        const blob = hb.hb_blob_create(data, font.byteLength, WRITABLE, 0, 0);
        const face = hb.hb_face_create(blob, 0);
        hb.hb_blob_destroy(blob);
        const input = hb.hb_subset_input_create_or_fail();
        if (options?.isRetainingGlyphIds === true) hb.hb_subset_input_set_flags(input, RETAIN_GIDS);
        const unicodes = hb.hb_subset_input_unicode_set(input);
        for (const codepoint of kept) hb.hb_set_add(unicodes, codepoint);
        const subset = hb.hb_subset_or_fail(face, input);
        hb.hb_subset_input_destroy(input);
        hb.hb_face_destroy(face);
        if (subset === 0) throw new Error('HarfBuzz could not subset the font.');
        const result = hb.hb_face_reference_blob(subset);
        const bytes = new Uint8Array(
          hb.memory.buffer,
          hb.hb_blob_get_data(result, 0),
          hb.hb_blob_get_length(result),
        ).slice();
        hb.hb_blob_destroy(result);
        hb.hb_face_destroy(subset);
        return bytes;
      } finally {
        hb.free(data);
      }
    },
  };
}
