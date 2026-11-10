// The part of msdfgen's WebAssembly build (Emscripten + Embind, as shipped in
// @zappar/msdf-generator 1.2.4's `msdfgen_wasm.js`) that the MSDF job uses, typed structurally so
// the engine never imports the module: the app's job-worker script loads it and hands a loader to
// `createMsdfJobHandler`. The binding's own names (`push_back`) are kept.
/* eslint-disable @typescript-eslint/naming-convention -- msdfgen's Embind binding defines these names */

/** An Embind `std::vector<unsigned char>`: how font bytes enter the module. */
export interface MsdfgenByteVector {
  /** Appends one byte. */
  push_back(value: number): void;
  /** Frees the vector's memory in the module. */
  delete(): void;
}

/** A glyph's geometry from msdfgen, in em units (the module normalises to an em of 1). */
export interface MsdfgenGlyphShape {
  /** The advance width, in em. */
  readonly advance: number;
  /** Left edge of the bounds, in em; the bounds always include the origin. */
  readonly left: number;
  /** Bottom edge of the bounds, in em. */
  readonly bottom: number;
  /** Right edge of the bounds, in em. */
  readonly right: number;
  /** Top edge of the bounds, in em. */
  readonly top: number;
}

/** A generated field: RGB bytes, rows top to bottom. */
export interface MsdfgenBitmap {
  /** Width, in texels. */
  readonly width: number;
  /** Height, in texels. */
  readonly height: number;
  /** The bytes, `width × height × 3`. */
  readonly data: {
    /** Reads one byte. */
    get(index: number): number;
    /** The number of bytes. */
    size(): number;
    /** Frees the bytes in the module. */
    delete(): void;
  };
}

/** A font loaded into msdfgen. */
export interface MsdfgenFont {
  /** Loads a font file; `false` when msdfgen cannot read it. */
  loadFromMemory(bytes: MsdfgenByteVector): boolean;
  /** A glyph's advance and bounds, by Unicode codepoint. */
  getGlyphShape(codepoint: number): MsdfgenGlyphShape;
  /**
   * Generates a glyph's MSDF with msdfgen's overlap fix (self-intersecting contours such as
   * B, P, R render without seams). A shape point `p` lands on texel coordinate
   * `scale × (p + translate)`, y up; `range` is the field's full width in texels.
   */
  generateMSDFWithOverlapFix(
    codepoint: number,
    width: number,
    height: number,
    range: number,
    translateX: number,
    translateY: number,
    scale: number,
  ): MsdfgenBitmap;
  /** Frees the font in the module. */
  delete(): void;
}

/** msdfgen's `Font` class. */
export interface MsdfgenFontClass {
  /** Creates an empty font. */
  new (): MsdfgenFont;
  /** The class's prototype, shared by its instances. */
  readonly prototype: MsdfgenFont;
}

/** Embind's `std::vector<unsigned char>` class. */
export interface MsdfgenByteVectorClass {
  /** Creates an empty byte vector. */
  new (): MsdfgenByteVector;
  /** The class's prototype, shared by its instances. */
  readonly prototype: MsdfgenByteVector;
}

/** The instantiated msdfgen module. */
export interface MsdfgenModule {
  /** The font class. */
  readonly Font: MsdfgenFontClass;
  /** The byte vector class. */
  readonly VectorUnsignedChar: MsdfgenByteVectorClass;
}

/**
 * Instantiates msdfgen, for example `() => createMSDFGenModule({ locateFile: () => wasmUrl })`
 * in the app's job worker. Called at most once per handler, on its first job.
 */
export type MsdfgenModuleLoader = () => Promise<MsdfgenModule>;
