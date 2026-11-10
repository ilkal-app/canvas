// A gradient's parameter at every pixel of a colour glyph's canvas. Repeat and reflect
// need the parameters the canvas shows, and a two-circle gradient's parameter is not bounded by
// its corners (it can climb without limit near the cone's edge), so it is evaluated at each
// pixel centre. Where the range needs more periods than a canvas gradient is written for, the
// colour line is evaluated at each pixel instead and drawn through the clip.

import type { ColourGlyphExtend, ColourGlyphStop } from '@canvas/text';

import type { ColourCanvasFactory, ColourContext2d } from './colour-canvas.js';
import type { CoverPoint } from './colour-gradients.js';
import { colourAt } from './colour-stops.js';

/** A gradient parameter per pixel, rows top to bottom; NaN where the gradient paints nothing. */
export interface ParameterField {
  /** Width, in px. */
  readonly width: number;
  /** Height, in px. */
  readonly height: number;
  /** The parameters. */
  readonly values: Float32Array;
}

/**
 * The parameter at each pixel centre of a canvas, through the inverse of its current transform.
 *
 * @param context - The canvas.
 * @param width - Width, in px.
 * @param height - Height, in px.
 * @param at - The parameter at a point in the drawing coordinates.
 * @returns The field, or undefined when the transform cannot be inverted.
 */
export function parameterField(
  context: ColourContext2d,
  width: number,
  height: number,
  at: (p: CoverPoint) => number,
): ParameterField | undefined {
  const { a, b, c, d, e, f } = context.getTransform();
  const determinant = a * d - b * c;
  if (determinant === 0) return undefined;
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const y = row + 0.5 - f;
    for (let column = 0; column < width; column += 1) {
      const x = column + 0.5 - e;
      values[row * width + column] = at({
        x: (d * x - c * y) / determinant,
        y: (a * y - b * x) / determinant,
      });
    }
  }
  return { width, height, values };
}

/**
 * The lowest and highest finite values of a field.
 *
 * @param field - The field.
 * @returns Their range, or undefined when none is finite.
 */
export function fieldRange(field: ParameterField): readonly [number, number] | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const value of field.values) {
    if (!Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return low > high ? undefined : [low, high];
}

/**
 * Paints a colour line at each pixel of a field onto a canvas, through its clip: the colours go
 * into a layer the size of the canvas, drawn with no transform.
 *
 * @param context - The canvas painted.
 * @param canvas - The factory the layer comes from.
 * @param field - The parameter per pixel.
 * @param line - The colour line.
 * @param line.stops - Its stops, in offset order.
 * @param line.extend - How it continues past them.
 * @throws {Error} When the layer has no 2D context.
 */
export function paintField(
  context: ColourContext2d,
  canvas: ColourCanvasFactory,
  field: ParameterField,
  line: { readonly stops: readonly ColourGlyphStop[]; readonly extend: ColourGlyphExtend },
): void {
  const layer = canvas.create(field.width, field.height);
  const layerContext = layer.getContext('2d');
  if (layerContext === null) throw new Error('A colour glyph needs a 2D canvas');
  const image = layerContext.createImageData(field.width, field.height);
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  field.values.forEach((t, index) => {
    if (Number.isNaN(t)) return;
    const color = colourAt(line.stops, line.extend, t);
    image.data.set(
      [channel(color.r), channel(color.g), channel(color.b), channel(color.a)],
      index * 4,
    );
  });
  layerContext.putImageData(image, 0, 0);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer, 0, 0);
  context.restore();
}
