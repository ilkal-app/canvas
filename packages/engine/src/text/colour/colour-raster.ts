// Rasterises a colour glyph's paint (`Shaper.colourGlyph`) into a premultiplied RGBA
// glyph bitmap at a tier, by replaying its operations into a 2D canvas: em, y up, mapped to the
// bitmap's pixels by one base transform.

import type {
  ColourGlyphComposite,
  ColourGlyphImage,
  ColourGlyphLinear,
  ColourGlyphOp,
  ColourGlyphProgram,
  ColourGlyphRadial,
  GlyphOutline,
} from '@canvas/text';

import { GLYPH_PADDING_PX, type GlyphBitmap } from '../atlas/glyph-bitmap.js';
import type { GlyphTier } from '../atlas/glyph-tiers.js';

import type {
  ColourCanvasFactory,
  ColourContext2d,
  ColourGradient,
  ColourImage,
} from './colour-canvas.js';
import {
  linearGradient,
  linearParameter,
  radialGradient,
  radialParameter,
  sweepGradient,
  type CoverPoint,
} from './colour-gradients.js';
import { fieldRange, paintField, parameterField } from './colour-pixels.js';
import { cssColour, MAX_PERIODS, periodsNeeded } from './colour-stops.js';

/** Where a colour glyph is drawn, in em, y up: usually its advance by the font's line extent. */
export interface ColourGlyphBox {
  /** The left edge. */
  readonly xMin: number;
  /** The bottom edge (the descender, below the baseline). */
  readonly yMin: number;
  /** The right edge. */
  readonly xMax: number;
  /** The top edge. */
  readonly yMax: number;
}

/** How a colour glyph is rasterised. */
export interface ColourRasterOptions {
  /** The canvases and image decoding. */
  readonly canvas: ColourCanvasFactory;
  /** The tier: pixels per em. */
  readonly tier: GlyphTier;
  /** The box drawn. */
  readonly box: ColourGlyphBox;
  /** The glyph's advance, in em; the box's width by default. */
  readonly advance?: number;
}

/** Far enough, in em, that a fill reaches past any clip. */
const COVER_EM = 1e4;

/** The canvas composite operation for each COLRv1 mode; `dest` and `clear` are drawn apart. */
const COMPOSITES: Readonly<Record<ColourGlyphComposite, string>> = {
  clear: 'destination-out',
  src: 'copy',
  dest: 'destination-over',
  'src-over': 'source-over',
  'dest-over': 'destination-over',
  'src-in': 'source-in',
  'dest-in': 'destination-in',
  'src-out': 'source-out',
  'dest-out': 'destination-out',
  'src-atop': 'source-atop',
  'dest-atop': 'destination-atop',
  xor: 'xor',
  plus: 'lighter',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  multiply: 'multiply',
  'hsl-hue': 'hue',
  'hsl-saturation': 'saturation',
  'hsl-color': 'color',
  'hsl-luminosity': 'luminosity',
};

/** A canvas in the replay: the glyph's, or a group's. */
interface Layer {
  readonly canvas: unknown;
  readonly context: ColourContext2d;
}

/**
 * Adds an outline's contours to the current path.
 *
 * @param context - The canvas.
 * @param outline - The outline, in em, y up.
 */
function tracePath(context: ColourContext2d, outline: GlyphOutline): void {
  context.beginPath();
  for (const contour of outline.contours) {
    const first = contour[0];
    if (first === undefined) continue;
    context.moveTo(first.x0, first.y0);
    for (const segment of contour) {
      if (segment.kind === 'line') context.lineTo(segment.x1, segment.y1);
      else if (segment.kind === 'quadratic') {
        context.quadraticCurveTo(segment.cx, segment.cy, segment.x1, segment.y1);
      } else {
        context.bezierCurveTo(
          segment.c1x,
          segment.c1y,
          segment.c2x,
          segment.c2y,
          segment.x1,
          segment.y1,
        );
      }
    }
    context.closePath();
  }
}

/**
 * Converts a canvas's unpremultiplied pixels to premultiplied RGBA bytes.
 *
 * @param data - The canvas's pixels.
 * @returns The premultiplied pixels.
 */
function premultiplied(data: Uint8ClampedArray): Uint8Array {
  const pixels = new Uint8Array(data.length);
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3] ?? 0;
    pixels[at] = Math.round(((data[at] ?? 0) * alpha) / 255);
    pixels[at + 1] = Math.round(((data[at + 1] ?? 0) * alpha) / 255);
    pixels[at + 2] = Math.round(((data[at + 2] ?? 0) * alpha) / 255);
    pixels[at + 3] = alpha;
  }
  return pixels;
}

/**
 * Rasterises a colour glyph into a premultiplied RGBA glyph bitmap at a tier, padded by
 * {@link GLYPH_PADDING_PX} like the distance-field bitmaps.
 *
 * @param program - The glyph's paint (`Shaper.colourGlyph`).
 * @param options - The canvas, the tier and the box drawn.
 * @returns The bitmap, field `colour`.
 * @throws {Error} When the canvas has no 2D context.
 */
export async function rasterColourGlyph(
  program: ColourGlyphProgram,
  options: ColourRasterOptions,
): Promise<GlyphBitmap> {
  const { tier, box, canvas } = options;
  const width = Math.ceil((box.xMax - box.xMin) * tier) + 2 * GLYPH_PADDING_PX;
  const height = Math.ceil((box.yMax - box.yMin) * tier) + 2 * GLYPH_PADDING_PX;
  const images = await decodeImages(program.ops, canvas);
  const root = layerOf(canvas, width, height);
  root.context.setTransform(
    tier,
    0,
    0,
    -tier,
    GLYPH_PADDING_PX - box.xMin * tier,
    GLYPH_PADDING_PX + box.yMax * tier,
  );
  const layers: Layer[] = [root];
  for (const op of program.ops) replay(op, layers, { canvas, width, height, images });
  return {
    field: 'colour',
    width,
    height,
    pixels: premultiplied(root.context.getImageData(0, 0, width, height).data),
    left: box.xMin * tier - GLYPH_PADDING_PX,
    top: box.yMax * tier + GLYPH_PADDING_PX,
    advance: (options.advance ?? box.xMax - box.xMin) * tier,
  };
}

/**
 * A new transparent canvas and its context.
 *
 * @param canvas - The factory.
 * @param width - Width, in px.
 * @param height - Height, in px.
 * @returns The layer.
 * @throws {Error} When the canvas has no 2D context.
 */
function layerOf(canvas: ColourCanvasFactory, width: number, height: number): Layer {
  const made = canvas.create(width, height);
  const context = made.getContext('2d');
  if (context === null) throw new Error('A colour glyph needs a 2D canvas');
  return { canvas: made, context };
}

/**
 * Decodes every image a program draws, before the replay, which is synchronous.
 *
 * @param ops - The program's operations.
 * @param canvas - The factory.
 * @returns The decoded images, by operation.
 */
async function decodeImages(
  ops: readonly ColourGlyphOp[],
  canvas: ColourCanvasFactory,
): Promise<Map<ColourGlyphImage, ColourImage>> {
  const images = new Map<ColourGlyphImage, ColourImage>();
  for (const op of ops) {
    if (op.op === 'image' && op.format === 'png') images.set(op, await canvas.decodePng(op.bytes));
  }
  return images;
}

/** What a replay step needs besides the layers. */
interface ReplayScope {
  readonly canvas: ColourCanvasFactory;
  readonly width: number;
  readonly height: number;
  readonly images: ReadonlyMap<ColourGlyphImage, ColourImage>;
}

/**
 * Replays one operation onto the innermost layer.
 *
 * @param op - The operation.
 * @param layers - The layers, the glyph's first and the innermost group last.
 * @param scope - The canvas factory, the bitmap size and the decoded images.
 */
function replay(op: ColourGlyphOp, layers: Layer[], scope: ReplayScope): void {
  const layer = layers.at(-1);
  if (layer === undefined) return;
  const { context } = layer;
  switch (op.op) {
    case 'push-transform':
      context.save();
      context.transform(op.xx, op.yx, op.xy, op.yy, op.dx, op.dy);
      return;
    case 'push-clip-glyph':
      context.save();
      tracePath(context, op.outline);
      context.clip('nonzero');
      return;
    case 'push-clip-rect':
      context.save();
      context.beginPath();
      context.rect(op.xMin, op.yMin, op.xMax - op.xMin, op.yMax - op.yMin);
      context.clip('nonzero');
      return;
    case 'pop-transform':
    case 'pop-clip':
      context.restore();
      return;
    case 'solid':
      fill(context, cssColour(op.color));
      return;
    case 'linear':
    case 'radial':
      fillGradient(context, op, scope);
      return;
    case 'sweep':
      fill(context, sweepGradient(context, op));
      return;
    case 'image':
      drawImage(context, op, scope.images.get(op));
      return;
    case 'push-group':
      layers.push(groupOf(context, scope));
      return;
    case 'pop-group':
      popGroup(layers, op.mode, scope);
  }
}

/**
 * Fills with a linear or radial gradient. A padding one is a canvas gradient as it is; a
 * repeating or reflecting one is written out over the parameters its pixels show, or, where
 * that needs more than {@link MAX_PERIODS} periods, painted pixel by pixel.
 *
 * @param context - The canvas.
 * @param op - The gradient.
 * @param scope - The factory and the bitmap size.
 */
function fillGradient(
  context: ColourContext2d,
  op: ColourGlyphLinear | ColourGlyphRadial,
  scope: ReplayScope,
): void {
  const make = (need?: readonly [number, number]): ColourGradient =>
    op.op === 'linear' ? linearGradient(context, op, need) : radialGradient(context, op, need);
  if (op.extend === 'pad') {
    fill(context, make());
    return;
  }
  const at = op.op === 'linear' ? linearParameter(op) : (p: CoverPoint) => radialParameter(op, p);
  const field = parameterField(context, scope.width, scope.height, at);
  const need = field === undefined ? undefined : fieldRange(field);
  if (field === undefined || need === undefined) return;
  if (periodsNeeded(op.stops, need) <= MAX_PERIODS) fill(context, make(need));
  else paintField(context, scope.canvas, field, op);
}

/**
 * Fills everything the clip lets through with a paint.
 *
 * @param context - The canvas.
 * @param paint - A CSS colour or a gradient.
 */
function fill(context: ColourContext2d, paint: unknown): void {
  context.fillStyle = paint;
  context.fillRect(-COVER_EM, -COVER_EM, 2 * COVER_EM, 2 * COVER_EM);
}

/**
 * Draws a decoded bitmap strike upright into its em box (the base transform is y up).
 *
 * @param context - The canvas.
 * @param op - The image operation.
 * @param image - Its decoded image; none draws nothing.
 */
function drawImage(context: ColourContext2d, op: ColourGlyphImage, image: ColourImage): void {
  if (image === undefined) return;
  // Flipped about the box, so the image's top row lands on its top edge under the y-up transform.
  context.save();
  context.transform(1, 0, 0, -1, 0, op.yMin + op.yMax);
  context.drawImage(image, op.xMin, op.yMin, op.xMax - op.xMin, op.yMax - op.yMin);
  context.restore();
}

/**
 * A new group layer drawing with the parent's transform.
 *
 * @param parent - The parent layer's context.
 * @param scope - The factory and the bitmap size.
 * @returns The group's layer.
 */
function groupOf(parent: ColourContext2d, scope: ReplayScope): Layer {
  const group = layerOf(scope.canvas, scope.width, scope.height);
  const m = parent.getTransform();
  group.context.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  return group;
}

/**
 * Ends the innermost group, compositing it onto its parent by the COLRv1 mode: `dest` keeps the
 * parent as it is, `clear` clears it, any other draws the group with its canvas operation.
 *
 * @param layers - The layers.
 * @param mode - The composite mode.
 * @param scope - The bitmap size.
 */
function popGroup(layers: Layer[], mode: ColourGlyphComposite, scope: ReplayScope): void {
  if (layers.length < 2) return;
  const group = layers.pop();
  const parent = layers.at(-1);
  if (group === undefined || parent === undefined || mode === 'dest') return;
  const { context } = parent;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (mode === 'clear') context.clearRect(0, 0, scope.width, scope.height);
  else {
    context.globalCompositeOperation = COMPOSITES[mode];
    context.drawImage(group.canvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
}
