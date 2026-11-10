// How exported vectors paint in PDF: numbers, colours, a group's blend mode, and a
// gradient's resolved colour line as a shading (axial or radial) with a stitched colour function.
// PDF shadings only pad, so repeat and reflect are drawn by stitching the line over many periods.
// Pure.
import type { ColourGlyphComposite } from '../shaping/colour-glyph.js';

import type { VectorLinearGradient, VectorRadialGradient } from './colour-layers.js';
import type { ColourLine, ResolvedStop, Rgba } from './colour-line.js';
import { formatNumber, type Affine } from './glyph-path-data.js';

/** How many periods a repeating or reflecting shading spans on each side of its line. */
export const SPREAD_PERIODS = 16;

/** The PDF blend modes the COLRv1 composites map to; the rest are Porter-Duff, drawn src-over. */
const BLEND_MODES: Partial<Record<ColourGlyphComposite, string>> = {
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  'hsl-hue': 'Hue',
  'hsl-saturation': 'Saturation',
  'hsl-color': 'Color',
  'hsl-luminosity': 'Luminosity',
};

/**
 * The PDF blend mode for a composite: null for plain painting (src-over), undefined for a
 * Porter-Duff mode PDF has no blend for.
 *
 * @param mode - The composite.
 * @returns The PDF mode's name, null, or undefined.
 */
export function pdfBlendMode(mode: ColourGlyphComposite): string | null | undefined {
  return mode === 'src-over' ? null : BLEND_MODES[mode];
}

/**
 * A number exactly, as PDF writes reals: no exponent, no `-0`.
 *
 * @param value - The number.
 * @returns Its text.
 */
export function pdfNumber(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  const text = String(value);
  return text.includes('e') ? value.toFixed(9).replace(/\.?0+$/, '') : text;
}

/**
 * An affine as PDF's six `cm` operands.
 *
 * @param transform - The affine.
 * @returns The operands.
 */
export function matrixOperands(transform: Affine): string {
  const { a, b, c, d, e, f } = transform;
  return [a, b, c, d, e, f].map(formatNumber).join(' ');
}

/**
 * A colour's RGB as `r g b`, three decimals.
 *
 * @param rgba - The colour.
 * @returns The operands.
 */
export function rgbOperands(rgba: Rgba): string {
  return rgba
    .slice(0, 3)
    .map((channel) => formatNumber(Math.min(1, Math.max(0, channel))))
    .join(' ');
}

/** One interpolating piece of a colour function, over [from, to] of its domain. */
interface Piece {
  /** Where it starts. */
  readonly from: number;
  /** Where it ends. */
  readonly to: number;
  /** Its colour at the start. */
  readonly c0: Rgba;
  /** Its colour at the end. */
  readonly c1: Rgba;
}

/**
 * A type 3 (stitching) function of type 2 pieces over a domain.
 *
 * @param pieces - The pieces, in order, covering the domain end to end.
 * @param from - The domain's start.
 * @param to - The domain's end.
 * @returns The function dictionary.
 */
function stitched(pieces: readonly Piece[], from: number, to: number): string {
  const n = pdfNumber;
  const functions = pieces
    .map(
      ({ c0, c1 }) =>
        `<< /FunctionType 2 /Domain [0 1] /C0 [${rgbOperands(c0)}] /C1 [${rgbOperands(c1)}] /N 1 >>`,
    )
    .join(' ');
  const bounds = pieces
    .slice(1)
    .map(({ from: at }) => n(at))
    .join(' ');
  const encode = pieces.map(() => '0 1').join(' ');
  return `<< /FunctionType 3 /Domain [${n(from)} ${n(to)}] /Functions [${functions}] /Bounds [${bounds}] /Encode [${encode}] >>`;
}

/**
 * A colour line's pieces over 0..1: one per pair of stops with distinct offsets (a pair at one
 * offset is a hard step between two pieces), and a constant piece before the first stop or after
 * the last when they are not at 0 and 1.
 *
 * @param stops - The resolved stops, in order.
 * @returns The pieces.
 */
function piecesOf(stops: readonly ResolvedStop[]): Piece[] {
  const pieces: Piece[] = [];
  let previous: ResolvedStop | undefined;
  for (const stop of stops) {
    if (previous === undefined && stop.offset > 0)
      pieces.push({ from: 0, to: stop.offset, c0: stop.rgba, c1: stop.rgba });
    if (previous !== undefined && stop.offset > previous.offset)
      pieces.push({ from: previous.offset, to: stop.offset, c0: previous.rgba, c1: stop.rgba });
    previous = stop;
  }
  // After the last stop (or with none: transparent black), its colour to the end.
  const end = previous ?? { offset: 0, rgba: [0, 0, 0, 0] as const };
  if (end.offset < 1) pieces.push({ from: end.offset, to: 1, c0: end.rgba, c1: end.rgba });
  return pieces;
}

/**
 * How far, in line lengths, a shading may run before and after its line: a linear one freely, a
 * radial one only while its radius stays zero or more.
 *
 * @param gradient - The gradient.
 * @param wanted - The reach wanted on each side.
 * @returns The domain, from `-before` to `1 + after`.
 */
function reach(
  gradient: VectorLinearGradient | VectorRadialGradient,
  wanted: number,
): [number, number] {
  if (gradient.kind === 'linear') return [-wanted, 1 + wanted];
  const { r0, r1 } = gradient;
  if (r1 > r0) return [Math.max(-wanted, -r0 / (r1 - r0)), 1 + wanted];
  if (r0 > r1) return [-wanted, Math.min(1 + wanted, 1 + r1 / (r0 - r1))];
  return [-wanted, 1 + wanted];
}

/**
 * The geometry's coordinates over a domain of its line.
 *
 * @param gradient - The gradient.
 * @param from - The domain's start, on the line.
 * @param to - Its end.
 * @returns The `/Coords` operands.
 */
function coordsOver(
  gradient: VectorLinearGradient | VectorRadialGradient,
  from: number,
  to: number,
): string {
  const at = (a: number, b: number, t: number) => a + (b - a) * t;
  if (gradient.kind === 'linear') {
    const { x0, y0, x1, y1 } = gradient;
    if (from === 0 && to === 1) return [x0, y0, x1, y1].map(pdfNumber).join(' ');
    return [at(x0, x1, from), at(y0, y1, from), at(x0, x1, to), at(y0, y1, to)]
      .map(pdfNumber)
      .join(' ');
  }
  const { x0, y0, r0, x1, y1, r1 } = gradient;
  if (from === 0 && to === 1) return [x0, y0, r0, x1, y1, r1].map(pdfNumber).join(' ');
  const ends = [at(x0, x1, from), at(y0, y1, from), Math.max(0, at(r0, r1, from))];
  return [...ends, at(x0, x1, to), at(y0, y1, to), Math.max(0, at(r0, r1, to))]
    .map(pdfNumber)
    .join(' ');
}

/**
 * A padded shading. Extend holds the colour the function gives at each end, which for a hard step
 * at an end (two stops at 0, or at 1) is the inner stop's; so the domain reaches one line length
 * past such an end (a radial one only while its radius stays zero or more), in the outer stop's
 * colour.
 *
 * @param line - The resolved line, padded.
 * @param head - The shading's type and colour space entries.
 * @returns The shading dictionary.
 */
function padShading(
  line: ColourLine<VectorLinearGradient | VectorRadialGradient>,
  head: string,
): string {
  const { gradient, stops } = line;
  const isStepAt = (offset: number) => stops.filter((stop) => stop.offset === offset).length > 1;
  const [lowest, highest] = reach(gradient, 1);
  const from = isStepAt(0) ? lowest : 0;
  const to = isStepAt(1) ? highest : 1;
  const pieces = piecesOf(stops);
  const first = stops[0]?.rgba ?? [0, 0, 0, 0];
  const last = stops.at(-1)?.rgba ?? first;
  if (from < 0) pieces.unshift({ from, to: 0, c0: first, c1: first });
  if (to > 1) pieces.push({ from: 1, to, c0: last, c1: last });
  const domain = `${pdfNumber(from)} ${pdfNumber(to)}`;
  const coords = coordsOver(gradient, from, to);
  return `<< ${head} /Coords [${coords}] /Domain [${domain}] /Function ${stitched(pieces, from, to)} /Extend [true true] >>`;
}

/**
 * A linear or radial gradient's resolved colour line (`colourLineOf`) as an axial (type 2) or
 * radial (type 3) shading in the gradient's em space (the caller sets its transform with `cm`).
 * Pad is the line with its ends extended. Repeat and reflect, which PDF shadings cannot spread,
 * stitch the line over {@link SPREAD_PERIODS} periods each side (a radial one only while its
 * radius stays zero or more), reflect alternating the encode direction.
 *
 * @param line - The resolved line of a gradient that is not a sweep.
 * @returns The shading dictionary.
 */
export function shadingOf(line: ColourLine<VectorLinearGradient | VectorRadialGradient>): string {
  const { gradient } = line;
  const type = gradient.kind === 'linear' ? 2 : 3;
  const head = `/ShadingType ${String(type)} /ColorSpace /DeviceRGB`;
  const base = stitched(piecesOf(line.stops), 0, 1);
  if (gradient.extend === 'pad') return padShading(line, head);
  const [from, to] = reach(gradient, SPREAD_PERIODS);
  const isReflect = gradient.extend === 'reflect';
  const pieces: string[] = [];
  const bounds: string[] = [];
  const encode: string[] = [];
  for (let period = Math.floor(from); period < Math.ceil(to); period += 1) {
    pieces.push(base);
    if (period > Math.floor(from)) bounds.push(pdfNumber(period));
    const isMirrored = isReflect && Math.abs(period) % 2 === 1;
    const [start, end] = [Math.max(from, period), Math.min(to, period + 1)];
    const [e0, e1] = [start - period, end - period];
    encode.push(
      isMirrored
        ? `${pdfNumber(1 - e0)} ${pdfNumber(1 - e1)}`
        : `${pdfNumber(e0)} ${pdfNumber(e1)}`,
    );
  }
  const domain = `${pdfNumber(from)} ${pdfNumber(to)}`;
  const spread = `<< /FunctionType 3 /Domain [${domain}] /Functions [${pieces.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`;
  return `<< ${head} /Coords [${coordsOver(gradient, from, to)}] /Domain [${domain}] /Function ${spread} /Extend [true true] >>`;
}
