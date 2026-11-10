// HarfBuzz shaping: harfbuzzjs, HarfBuzz's own WebAssembly build, loaded once per process
// by a dynamic import, so importing @canvas/text starts no WebAssembly. Shaping is synchronous once
// it has loaded; a face is made once per id from a font file's bytes and kept while the files the
// shaper keeps fit in a byte budget, the least recently used dropped first. A
// variable face's instances share its HarfBuzz face, each with a font of its own, of
// which only the most recently used are kept.

import type * as HarfBuzzModule from 'harfbuzzjs';

import type { GlyphOutline } from '../font/glyph-outline.js';
import { readVariationAxes, type VariationAxis } from '../variation/fvar.js';
import { normaliseVariations } from '../variation/normalise-variations.js';
import { variationKey } from '../variation/variation-key.js';

import { ColourGlyphRecorder, hasColourGlyphs } from './colour-glyph-recorder.js';
import type { ColourGlyphOptions } from './colour-glyph.js';
import { FaceSources } from './face-sources.js';
import { harfBuzzFeaturesOf } from './harfbuzz-features.js';
import { HeldFaces } from './held-faces.js';
import { InstanceFonts } from './instance-fonts.js';
import { OutlineBuilder } from './outline-builder.js';
import type { ShapedGlyph, ShapedRun, Shaper, ShapingFace } from './shaper-types.js';
import { guessDirection, type TextDirection } from './text-direction.js';

export { MAX_VARIATION_INSTANCES } from './instance-fonts.js';

/**
 * The most font-file bytes a shaper keeps (128 MiB): a session's whole library and
 * its coverage fonts fit many times over, and faces added and replaced for a long session cannot
 * grow it without bound. Past it the least recently used files are dropped, and read again from
 * the bytes their next use passes.
 */
export const MAX_SHAPER_FACE_BYTES = 128 * 1024 * 1024;

/** harfbuzzjs's module, loaded by a dynamic import. */
type HarfBuzz = typeof HarfBuzzModule;

export type { ShapedGlyph, ShapedRun, Shaper, ShapingFace } from './shaper-types.js';

/**
 * The UTF-16 code units of context passed on each side of a stretch: HarfBuzz keeps five
 * characters of context, and twelve units hold five even if every one is a surrogate pair.
 */
const CONTEXT_UNITS = 12;

/** The line feed, which ends a paragraph's context. */
const NEWLINE = 0x0a;

/** A glyph without a position: never, as HarfBuzz gives one per glyph. */
const NO_POSITION = { xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 } as const;

/** A HarfBuzz font. */
type HarfBuzzFont = InstanceType<HarfBuzz['Font']>;

/** A font file as the shaper keeps it: one HarfBuzz face for the default and every instance. */
interface LoadedSource {
  readonly hbFace: InstanceType<HarfBuzz['Face']>;
  /** Its variation axes; none for a static font. */
  readonly axes: readonly VariationAxis[];
  /** Its default instance, with its font, kept while the shaper keeps the file. */
  readonly base: ShapingFace;
  /**
   * Its instances' faces by variation key, held weakly: one face per key while any caller holds
   * it, however often its font is dropped and made again.
   */
  readonly instances: HeldFaces<ShapingFace>;
  /** The font file's size, counted against the shaper's budget. */
  readonly size: number;
}

/** A face as the shaper keeps it. */
interface LoadedFace {
  readonly face: ShapingFace;
  readonly source: LoadedSource;
  /** The default instance's font; an instance's is in the shaper's instance fonts. */
  readonly font: HarfBuzzFont | undefined;
}

/** HarfBuzz and the state shaping reuses. */
class HarfBuzzShaper implements Shaper {
  readonly version: string;
  private readonly sources: FaceSources<LoadedSource>;
  /** The faces this shaper made: a face is its own object, as another shaper's may share its id. */
  private readonly loaded = new WeakMap<ShapingFace, LoadedFace>();
  private readonly instanceFonts = new InstanceFonts<LoadedFace, HarfBuzzFont>((loaded) =>
    this.instanceFont(loaded),
  );
  private readonly buffer: InstanceType<HarfBuzz['Buffer']>;
  /** The glyph being drawn; harfbuzzjs keeps every set of draw functions, so there is one. */
  private builder = new OutlineBuilder(1);
  private drawFuncs: InstanceType<HarfBuzz['DrawFuncs']> | undefined;
  private colour: ColourGlyphRecorder | undefined;

  constructor(
    readonly hb: HarfBuzz,
    maxFaceBytes: number,
  ) {
    this.version = hb.versionString();
    this.buffer = new hb.Buffer();
    this.sources = new FaceSources(maxFaceBytes);
  }

  get retainedFaceBytes(): number {
    return this.sources.retainedBytes;
  }

  outline(face: ShapingFace, glyphId: number): GlyphOutline {
    const font = this.fontOf(face);
    if (!Number.isInteger(glyphId) || glyphId < 0) return { contours: [] };
    this.builder = new OutlineBuilder(face.unitsPerEm);
    try {
      font.drawGlyph(glyphId, this.funcs());
    } catch {
      return { contours: [] };
    }
    return this.builder.finish();
  }

  hasColourGlyphs(face: ShapingFace): boolean {
    this.fontOf(face);
    return hasColourGlyphs(this.loaded.get(face)?.source.hbFace);
  }

  colourGlyph(face: ShapingFace, glyphId: number, options?: ColourGlyphOptions) {
    const font = this.fontOf(face);
    const hbFace = this.loaded.get(face)?.source.hbFace;
    this.colour ??= new ColourGlyphRecorder(this.hb);
    const outlineOf = (id: number): GlyphOutline => this.outline(face, id);
    return this.colour.record({ font, hbFace, face, outlineOf }, glyphId, options ?? {});
  }

  /**
   * The shaper's one set of draw functions, made on first use; each forwards to the glyph being
   * drawn.
   *
   * @returns The draw functions.
   */
  private funcs(): InstanceType<HarfBuzz['DrawFuncs']> {
    if (this.drawFuncs !== undefined) return this.drawFuncs;
    const funcs = new this.hb.DrawFuncs();
    funcs.setMoveToFunc((x, y) => {
      this.builder.moveTo(x, y);
    });
    funcs.setLineToFunc((x, y) => {
      this.builder.lineTo(x, y);
    });
    funcs.setQuadraticToFunc((cx, cy, x, y) => {
      this.builder.quadraticTo(cx, cy, x, y);
    });
    funcs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y) => {
      this.builder.cubicTo(c1x, c1y, c2x, c2y, x, y);
    });
    funcs.setClosePathFunc(() => {
      this.builder.closePath();
    });
    this.drawFuncs = funcs;
    return funcs;
  }

  face(
    id: string,
    bytes: Uint8Array,
    variations: Readonly<Record<string, number>> = {},
  ): ShapingFace {
    const source = this.sources.use(id) ?? this.load(id, bytes);
    const normalised = normaliseVariations(source.axes, variations);
    const key = variationKey(normalised);
    if (key === '') return source.base;
    const known = source.instances.get(key);
    if (known !== undefined) {
      this.fontOf(known);
      return known;
    }
    const face: ShapingFace = {
      id,
      unitsPerEm: source.base.unitsPerEm,
      variations: normalised,
      variationKey: key,
    };
    const loaded: LoadedFace = { face, source, font: undefined };
    this.loaded.set(face, loaded);
    source.instances.set(key, face);
    this.instanceFonts.fontOf(loaded);
    return face;
  }

  /**
   * Reads a font file: its HarfBuzz face, its axes and its default instance.
   *
   * @param id - The face's id.
   * @param bytes - The font file.
   * @returns The source, now kept for the id.
   */
  private load(id: string, bytes: Uint8Array): LoadedSource {
    const { hb } = this;
    const hbFace = new hb.Face(new hb.Blob(bytes.slice().buffer));
    const base: ShapingFace = { id, unitsPerEm: hbFace.upem, variations: {}, variationKey: '' };
    const axes = readVariationAxes(bytes)?.axes ?? [];
    const source: LoadedSource = {
      hbFace,
      axes,
      base,
      instances: new HeldFaces(),
      size: bytes.length,
    };
    this.sources.add(id, source);
    this.loaded.set(base, { face: base, source, font: new hb.Font(hbFace) });
    return source;
  }

  /**
   * The font a face of this shaper draws with: the default instance's own, or an instance's from
   * the instance fonts, made again if it was dropped.
   *
   * @param face - The face.
   * @returns Its font.
   * @throws {RangeError} When the face is not this shaper's.
   */
  private fontOf(face: ShapingFace): HarfBuzzFont {
    const loaded = this.loaded.get(face);
    if (loaded === undefined) throw new RangeError(`The shaper has no face "${face.id}".`);
    return loaded.font ?? this.instanceFonts.fontOf(loaded);
  }

  /**
   * A new font for an instance: its source's HarfBuzz face at the instance's coordinates.
   *
   * @param loaded - The instance.
   * @returns The font.
   */
  private instanceFont(loaded: LoadedFace): HarfBuzzFont {
    const { hb } = this;
    const font = new hb.Font(loaded.source.hbFace);
    const coordinates = Object.entries(loaded.face.variations);
    font.setVariations(coordinates.map(([tag, value]) => new hb.Variation(tag, value)));
    return font;
  }

  /**
   * Shapes a stretch of text with one of this shaper's faces.
   *
   * @param face - The face.
   * @param text - The whole text.
   * @param start - The first UTF-16 index to shape.
   * @param end - One past the last.
   * @param stated - The direction to shape in (the bidi level's); guessed when absent.
   * @param language - The text's language, a BCP 47 tag: HarfBuzz applies its
   *   language-specific forms; when absent HarfBuzz uses none.
   * @param features - OpenType feature settings, tag to value, over HarfBuzz's
   *   defaults; none when absent or empty.
   * @returns The glyphs, in visual order, and the direction.
   * @throws {RangeError} When the face is not this shaper's.
   */
  shape(
    face: ShapingFace,
    text: string,
    start: number,
    end: number,
    stated?: TextDirection,
    language?: string,
    features?: Readonly<Record<string, number>>,
  ): ShapedRun {
    const font = this.fontOf(face);
    const direction = stated ?? guessDirection(text, start, end);
    if (start === end) return { direction, glyphs: [] };
    // HarfBuzz reads the characters around the item as context, at most five on each side
    // (HB_BUFFER_CONTEXT_LENGTH), within its paragraph. Only that window is copied: copying the
    // whole paragraph for each stretch cost a long text's layout a pass per segment.
    let from = Math.max(0, start - CONTEXT_UNITS);
    for (let index = start - 1; index >= from; index -= 1) {
      if (text.charCodeAt(index) === NEWLINE) {
        from = index + 1;
        break;
      }
    }
    let to = Math.min(text.length, end + CONTEXT_UNITS);
    for (let index = end; index < to; index += 1) {
      if (text.charCodeAt(index) === NEWLINE) {
        to = index;
        break;
      }
    }
    const { hb, buffer } = this;
    buffer.reset();
    buffer.addText(text.slice(from, to), start - from, end - start);
    buffer.setDirection(direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
    if (language !== undefined) buffer.setLanguage(language);
    buffer.guessSegmentProperties();
    buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
    const settings = harfBuzzFeaturesOf(hb, features);
    if (settings === undefined) hb.shape(font, buffer);
    else hb.shape(font, buffer, settings);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const em = face.unitsPerEm;
    const glyphs = infos.map((info, index): ShapedGlyph => {
      // HarfBuzz gives one position per glyph.
      const position = positions[index] ?? NO_POSITION;
      return {
        glyphId: info.codepoint,
        cluster: info.cluster + from,
        advance: position.xAdvance / em,
        xOffset: position.xOffset / em,
        yOffset: position.yOffset / em,
        isUnsafeToBreak: (info.flags & hb.GlyphFlag.UNSAFE_TO_BREAK) !== 0,
      };
    });
    return { direction, glyphs };
  }
}

let loading: Promise<Shaper> | undefined;

/**
 * The shaper text is measured with: the harfbuzzjs package and version, which pins the
 * HarfBuzz it embeds. `BUNDLED_FONTS_FINGERPRINT` hashes it, so a shaper upgrade marks every
 * stored size stale; a test holds it to the installed package.
 */
export const SHAPER_VERSION = 'harfbuzzjs@1.6.2';

/**
 * Loads HarfBuzz once per process (harfbuzzjs, by a dynamic import); later calls return the same
 * shaper.
 *
 * @returns The shaper.
 */
export function loadShaper(): Promise<Shaper> {
  loading ??= import('harfbuzzjs').then((hb) => createShaper(hb));
  return loading;
}

/**
 * A shaper of its own over a loaded harfbuzzjs, for a caller that needs another
 * budget than {@link loadShaper}'s; most callers use that process-wide one.
 *
 * @param hb - harfbuzzjs's module, as its dynamic import gives it.
 * @param options - The shaper's budget.
 * @param options.maxFaceBytes - The most font-file bytes it keeps; {@link MAX_SHAPER_FACE_BYTES}
 *   by default.
 * @returns The shaper.
 */
export function createShaper(
  hb: HarfBuzz,
  { maxFaceBytes = MAX_SHAPER_FACE_BYTES }: { readonly maxFaceBytes?: number } = {},
): Shaper {
  return new HarfBuzzShaper(hb, maxFaceBytes);
}

/**
 * Shapes `text[start, end)` with a face: HarfBuzz guesses the script and language, the direction
 * is guessed as HarfBuzz guesses it ({@link guessDirection}), HarfBuzz's default features apply under any given,
 * and clusters are monotone graphemes (level 0). Characters around the stretch, within its
 * paragraph, are context. Pure apart from the shaper's reused buffer.
 *
 * @param shaper - The shaper, from {@link loadShaper}.
 * @param face - The face, from the shaper.
 * @param text - The whole text.
 * @param start - The first UTF-16 index to shape.
 * @param end - One past the last UTF-16 index to shape.
 * @param direction - The direction to shape in; guessed as HarfBuzz would when absent.
 * @param language - The text's language, a BCP 47 tag; none when absent.
 * @param features - OpenType feature settings, tag to value; HarfBuzz's defaults when
 *   absent or empty.
 * @returns The glyphs, in visual order, and the direction.
 * @throws {TypeError} When the shaper is not one {@link loadShaper} made.
 */
export function shapeText(
  shaper: Shaper,
  face: ShapingFace,
  text: string,
  start: number,
  end: number,
  direction?: TextDirection,
  language?: string,
  features?: Readonly<Record<string, number>>,
): ShapedRun {
  if (!(shaper instanceof HarfBuzzShaper)) throw new TypeError('Shape with a loaded shaper.');
  return shaper.shape(face, text, start, end, direction, language, features);
}
