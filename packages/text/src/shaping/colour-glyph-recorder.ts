// Records HarfBuzz's paint calls for one colour glyph as a `ColourGlyphProgram`.
// harfbuzzjs keeps every set of paint functions it is given, so the recorder makes one and points
// it at the glyph being painted.

import type * as HarfBuzzModule from 'harfbuzzjs';

import type { GlyphOutline } from '../font/glyph-outline.js';

import {
  COLOUR_GLYPH_COMPOSITES,
  type ColourGlyphExtend,
  type ColourGlyphOp,
  type ColourGlyphOptions,
  type ColourGlyphProgram,
  type ColourGlyphRgba,
  type ColourGlyphStop,
} from './colour-glyph.js';
import { glyphCountOf, sbixPlacement } from './sbix-placement.js';
import type { ShapingFace } from './shaper.js';

/** harfbuzzjs's module, loaded by a dynamic import. */
type HarfBuzz = typeof HarfBuzzModule;

/** A HarfBuzz font. */
type HarfBuzzFont = InstanceType<HarfBuzz['Font']>;

/** A HarfBuzz colour: 8 bits per channel. */
type HarfBuzzColor = HarfBuzzModule.Color;

/** HarfBuzz's colour line. */
type HarfBuzzColorLine = HarfBuzzModule.ColorLine;

/** The foreground when the caller gives none: opaque black. */
const BLACK: ColourGlyphRgba = { r: 0, g: 0, b: 0, a: 1 };

/** A PNG's signature and IHDR chunk, up to its width and height. */
const PNG_HEADER_BYTES = 24;

/** HarfBuzz's extend modes, by value. */
const EXTENDS: readonly ColourGlyphExtend[] = ['pad', 'repeat', 'reflect'];

/** The glyph being painted. */
interface Painting {
  readonly ops: ColourGlyphOp[];
  readonly unitsPerEm: number;
  readonly outlineOf: (glyphId: number) => GlyphOutline;
  readonly table: (tag: string) => Uint8Array | undefined;
}

/**
 * A HarfBuzz colour as 0..1 channels.
 *
 * @param color - HarfBuzz's colour, 0..255 per channel.
 * @returns The colour.
 */
function rgbaOf(color: HarfBuzzColor): ColourGlyphRgba {
  return { r: color.red / 255, g: color.green / 255, b: color.blue / 255, a: color.alpha / 255 };
}

/**
 * A colour line's stops in offset order (HarfBuzz may give them out of order).
 *
 * @param line - HarfBuzz's colour line.
 * @returns The stops.
 */
function stopsOf(line: HarfBuzzColorLine): ColourGlyphStop[] {
  return line.colorStops
    .map((stop) => ({
      offset: stop.offset,
      color: rgbaOf(stop.color),
      isForeground: stop.isForeground,
    }))
    .sort((a, b) => a.offset - b.offset);
}

/** A HarfBuzz face. */
type HarfBuzzFace = InstanceType<HarfBuzz['Face']>;

/** The glyph a recorder paints: its font and face, and their outlines for glyph clips. */
export interface ColourGlyphTarget {
  /** The HarfBuzz font, at the font's own scale (font units). */
  readonly font: HarfBuzzFont;
  /** Its HarfBuzz face, for tables a bitmap's placement reads; absent, none are read. */
  readonly hbFace: HarfBuzzFace | undefined;
  /** The shaping face: its units per em turn font units into em. */
  readonly face: ShapingFace;
  /** A glyph's outline in em. */
  readonly outlineOf: (glyphId: number) => GlyphOutline;
}

/**
 * Whether a HarfBuzz face has colour glyphs: COLR paint or layers, or bitmap strikes.
 *
 * @param hbFace - The face; absent, none.
 * @returns True for a colour font.
 */
export function hasColourGlyphs(hbFace: HarfBuzzFace | undefined): boolean {
  if (hbFace === undefined) return false;
  return hbFace.hasColorPaint() || hbFace.hasColorLayers() || hbFace.hasColorPng();
}

/** Records colour glyphs with one HarfBuzz module's paint functions. */
export class ColourGlyphRecorder {
  private painting: Painting | undefined;
  private paintFuncs: InstanceType<HarfBuzz['PaintFuncs']> | undefined;

  /**
   * Makes a recorder; its paint functions are made on first use.
   *
   * @param hb - The loaded HarfBuzz module.
   */
  constructor(private readonly hb: HarfBuzz) {}

  /**
   * Records one glyph's colour paint.
   *
   * @param target - The glyph's font and face, and its outlines for glyph clips.
   * @param glyphId - The glyph's id; a negative or fractional id has no colour.
   * @param options - The palette and the foreground colour.
   * @returns The program; undefined for a glyph HarfBuzz paints no colour for.
   */
  record(
    target: ColourGlyphTarget,
    glyphId: number,
    options: ColourGlyphOptions,
  ): ColourGlyphProgram | undefined {
    if (!Number.isInteger(glyphId) || glyphId < 0) return undefined;
    const { font, hbFace } = target;
    const painting: Painting = {
      ops: [],
      unitsPerEm: target.face.unitsPerEm,
      outlineOf: target.outlineOf,
      table: (tag) => hbFace?.referenceTable(tag),
    };
    const foreground = options.foreground ?? BLACK;
    const hbForeground: HarfBuzzColor = {
      red: Math.round(foreground.r * 255),
      green: Math.round(foreground.g * 255),
      blue: Math.round(foreground.b * 255),
      alpha: Math.round(foreground.a * 255),
    };
    this.painting = painting;
    try {
      const isPainted = font.paintGlyphOrFail(
        glyphId,
        this.funcs(),
        undefined,
        options.palette ?? 0,
        hbForeground,
      );
      // This HarfBuzz build paints no bitmap strike: take the strike's PNG itself.
      if (!isPainted) this.strike(font, glyphId);
      return painting.ops.length > 0 ? { ops: painting.ops } : undefined;
    } finally {
      this.painting = undefined;
    }
  }

  /**
   * Adds an operation to the glyph being painted.
   *
   * @param op - The operation.
   */
  private push(op: ColourGlyphOp): void {
    this.painting?.ops.push(op);
  }

  /**
   * A length in font units, in em.
   *
   * @param value - Font units.
   * @returns Em.
   */
  private em(value: number): number {
    return value / (this.painting?.unitsPerEm ?? 1);
  }

  /**
   * The recorder's one set of paint functions, made on first use.
   *
   * @returns The paint functions.
   */
  private funcs(): InstanceType<HarfBuzz['PaintFuncs']> {
    if (this.paintFuncs !== undefined) return this.paintFuncs;
    const funcs = new this.hb.PaintFuncs();
    funcs.setPushTransformFunc((xx, yx, xy, yy, dx, dy) => {
      this.push({ op: 'push-transform', xx, yx, xy, yy, dx: this.em(dx), dy: this.em(dy) });
    });
    funcs.setPopTransformFunc(() => {
      this.push({ op: 'pop-transform' });
    });
    // False: HarfBuzz paints a referenced colour glyph's paint in place.
    funcs.setColorGlyphFunc(() => false);
    funcs.setPushClipGlyphFunc((glyph) => {
      const outline = this.painting?.outlineOf(glyph) ?? { contours: [] };
      this.push({ op: 'push-clip-glyph', outline });
    });
    funcs.setPushClipRectangleFunc((xMin, yMin, xMax, yMax) => {
      this.push({
        op: 'push-clip-rect',
        xMin: this.em(xMin),
        yMin: this.em(yMin),
        xMax: this.em(xMax),
        yMax: this.em(yMax),
      });
    });
    funcs.setPopClipFunc(() => {
      this.push({ op: 'pop-clip' });
    });
    funcs.setColorFunc((isForeground, color) => {
      this.push({ op: 'solid', color: rgbaOf(color), isForeground });
    });
    this.setGradientFuncs(funcs);
    funcs.setPushGroupFunc(() => {
      this.push({ op: 'push-group' });
    });
    funcs.setPopGroupFunc((mode) => {
      // An unknown mode composites as the default, source over.
      const isKnown = Number.isInteger(mode) && mode >= 0 && mode < COLOUR_GLYPH_COMPOSITES.length;
      this.push({ op: 'pop-group', mode: isKnown ? COLOUR_GLYPH_COMPOSITES[mode] : 'src-over' });
    });
    this.paintFuncs = funcs;
    return funcs;
  }

  /**
   * Sets the gradient callbacks: linear, radial and sweep, in em with their colour lines.
   *
   * @param funcs - The paint functions.
   */
  private setGradientFuncs(funcs: InstanceType<HarfBuzz['PaintFuncs']>): void {
    funcs.setLinearGradientFunc((line, x0, y0, x1, y1, x2, y2) => {
      this.push({
        op: 'linear',
        x0: this.em(x0),
        y0: this.em(y0),
        x1: this.em(x1),
        y1: this.em(y1),
        x2: this.em(x2),
        y2: this.em(y2),
        extend: EXTENDS[line.extend] ?? 'pad',
        stops: stopsOf(line),
      });
    });
    funcs.setRadialGradientFunc((line, x0, y0, r0, x1, y1, r1) => {
      this.push({
        op: 'radial',
        x0: this.em(x0),
        y0: this.em(y0),
        r0: this.em(r0),
        x1: this.em(x1),
        y1: this.em(y1),
        r1: this.em(r1),
        extend: EXTENDS[line.extend] ?? 'pad',
        stops: stopsOf(line),
      });
    });
    funcs.setSweepGradientFunc((line, x0, y0, startAngle, endAngle) => {
      this.push({
        op: 'sweep',
        x0: this.em(x0),
        y0: this.em(y0),
        startAngle,
        endAngle,
        extend: EXTENDS[line.extend] ?? 'pad',
        stops: stopsOf(line),
      });
    });
  }

  /**
   * Records a glyph's bitmap strike (sbix, CBDT) as a PNG image, if it has one: the largest strike,
   * placed at the glyph's extents.
   *
   * @param font - The HarfBuzz font.
   * @param glyphId - The glyph's id.
   */
  private strike(font: HarfBuzzFont, glyphId: number): void {
    const png = font.getGlyphColorPng(glyphId);
    if (png === undefined || png.length < PNG_HEADER_BYTES) return;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // The IHDR chunk, first after the signature: width and height, big-endian.
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    this.image(png, width, height, this.strikeExtents(font, glyphId, width, height));
  }

  /**
   * Where a strike's image sits, in font units: HarfBuzz's extents, or for an sbix glyph, which
   * this HarfBuzz build gives none, the strike's own placement.
   *
   * @param font - The HarfBuzz font.
   * @param glyphId - The glyph's id.
   * @param width - The image's width in pixels.
   * @param height - The image's height in pixels.
   * @returns The extents, y up as HarfBuzz gives them (a negative height runs down).
   */
  private strikeExtents(
    font: HarfBuzzFont,
    glyphId: number,
    width: number,
    height: number,
  ): HarfBuzzModule.GlyphExtents | undefined {
    const extents = font.glyphExtents(glyphId);
    if (extents !== undefined && extents.width !== 0 && extents.height !== 0) return extents;
    const sbix = this.painting?.table('sbix');
    const maxp = this.painting?.table('maxp');
    const glyphCount = maxp === undefined ? 0 : glyphCountOf(maxp);
    const placement = sbix === undefined ? undefined : sbixPlacement(sbix, glyphId, glyphCount);
    if (placement === undefined) return undefined;
    const units = (this.painting?.unitsPerEm ?? 1) / placement.ppem;
    return {
      xBearing: placement.originX * units,
      yBearing: (placement.originY + height) * units,
      width: width * units,
      height: -height * units,
    };
  }

  /**
   * Records a PNG strike at its extents, y up in font units; none without extents.
   *
   * @param png - The PNG's bytes.
   * @param width - Its width in pixels.
   * @param height - Its height in pixels.
   * @param extents - Where the glyph draws it.
   */
  private image(
    png: Uint8Array,
    width: number,
    height: number,
    extents: HarfBuzzModule.GlyphExtents | undefined,
  ): void {
    if (extents === undefined) return;
    const x0 = extents.xBearing;
    const x1 = extents.xBearing + extents.width;
    const y0 = extents.yBearing;
    const y1 = extents.yBearing + extents.height;
    this.push({
      op: 'image',
      format: 'png',
      bytes: png.slice(),
      width,
      height,
      xMin: this.em(Math.min(x0, x1)),
      yMin: this.em(Math.min(y0, y1)),
      xMax: this.em(Math.max(x0, x1)),
      yMax: this.em(Math.max(y0, y1)),
    });
  }
}
