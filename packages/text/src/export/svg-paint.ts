// How exported vectors paint in SVG: colours and opacity, gradients, a sweep's wedges,
// a colour glyph group's blend mode. Pure.
import type { ColourGlyphComposite } from '../shaping/colour-glyph.js';

import type { VectorGradient } from './colour-layers.js';
import { colourAtStops, type ColourLine, type ResolvedStop, type Rgba } from './colour-line.js';
import { formatNumber, type Affine } from './glyph-path-data.js';

export type { ColorOf, Rgba } from './colour-line.js';

/** How many wedges approximate a sweep gradient. */
export const SWEEP_WEDGES = 64;

/** A sweep's wedge radius, in em: far past any glyph's clip. */
const SWEEP_RADIUS_EM = 64;

/** The CSS blend modes the COLRv1 composites map to; the rest are Porter-Duff, drawn src-over. */
const BLEND_MODES: Partial<Record<ColourGlyphComposite, string>> = {
  multiply: 'multiply',
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
  'hsl-hue': 'hue',
  'hsl-saturation': 'saturation',
  'hsl-color': 'color',
  'hsl-luminosity': 'luminosity',
};

/**
 * The CSS blend mode for a composite, `null` for plain painting (`src-over`), or undefined for
 * a Porter-Duff mode SVG cannot draw.
 *
 * @param mode - The composite.
 * @returns The CSS mode, null, or undefined.
 */
export function cssBlendMode(mode: ColourGlyphComposite): string | null | undefined {
  return mode === 'src-over' ? null : BLEND_MODES[mode];
}

/**
 * Text escaped for XML content and attribute values.
 *
 * @param text - The text.
 * @returns The escaped text.
 */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * A colour as `#rrggbb`.
 *
 * @param rgba - The colour.
 * @returns Its hex, alpha left out.
 */
export function hexOf(rgba: Rgba): string {
  return `#${rgba
    .slice(0, 3)
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The attributes that fill with a colour: `fill` and, when not opaque, `fill-opacity`.
 *
 * @param rgba - The colour.
 * @param alpha - A further alpha to multiply in.
 * @returns The attributes' text.
 */
export function fillAttributes(rgba: Rgba, alpha = 1): string {
  const opacity = rgba[3] * alpha;
  return opacity === 1
    ? `fill="${hexOf(rgba)}"`
    : `fill="${hexOf(rgba)}" fill-opacity="${formatNumber(opacity)}"`;
}

/**
 * An affine as an SVG `matrix(…)`.
 *
 * @param transform - The affine.
 * @returns The transform list's text.
 */
export function matrixOf(transform: Affine): string {
  const { a, b, c, d, e, f } = transform;
  return `matrix(${[a, b, c, d, e, f].map(formatNumber).join(' ')})`;
}

/**
 * A resolved colour line's stops as `<stop>`s.
 *
 * @param stops - The stops.
 * @returns The elements' text.
 */
function stopElements(stops: readonly ResolvedStop[]): string {
  return stops
    .map(({ offset, rgba }) => {
      const opacity = formatNumber(rgba[3]);
      return `<stop offset="${formatNumber(offset)}" stop-color="${hexOf(rgba)}" stop-opacity="${opacity}"/>`;
    })
    .join('');
}

/**
 * A linear or radial gradient as a `<linearGradient>` or `<radialGradient>` in user space, from
 * its resolved colour line (`colourLineOf`: normalised to its first and last stops, a cone cut at
 * its tip), which SVG spreads over 0..1. The radial focal circle (`fr`) is SVG 2.
 *
 * @param id - Its id.
 * @param line - The resolved line of a gradient that is not a sweep.
 * @returns The element's text.
 */
export function gradientElement(
  id: string,
  line: ColourLine<Exclude<VectorGradient, { kind: 'sweep' }>>,
): string {
  const n = formatNumber;
  const { gradient } = line;
  const shared = `id="${id}" gradientUnits="userSpaceOnUse" gradientTransform="${matrixOf(gradient.transform)}" spreadMethod="${gradient.extend}"`;
  const stops = stopElements(line.stops);
  if (gradient.kind === 'linear') {
    const { x0, y0, x1, y1 } = gradient;
    return `<linearGradient ${shared} x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}">${stops}</linearGradient>`;
  }
  const { x0, y0, r0, x1, y1, r1 } = gradient;
  return `<radialGradient ${shared} fx="${n(x0)}" fy="${n(y0)}" fr="${n(r0)}" cx="${n(x1)}" cy="${n(y1)}" r="${n(r1)}">${stops}</radialGradient>`;
}

/**
 * Where along a colour line a value falls, after the gradient's extend.
 *
 * @param t - The value, 0 at the line's start, 1 at its end.
 * @param extend - How the line continues past its ends.
 * @returns The position on the line, 0..1.
 */
function extended(t: number, extend: VectorGradient['extend']): number {
  if (extend === 'pad') return Math.min(1, Math.max(0, t));
  const cycle = t - Math.floor(t);
  if (extend === 'repeat') return cycle;
  return Math.floor(t) % 2 === 0 ? cycle : 1 - cycle;
}

/**
 * A sweep gradient as solid wedges about its centre, coloured along its resolved line at each
 * wedge's middle angle: SVG has no conic gradient. The caller clips them to the layer's region.
 *
 * @param line - The sweep's resolved colour line (`colourLineOf`).
 * @returns The wedges' `<path>` elements.
 */
export function sweepWedges(line: ColourLine<Extract<VectorGradient, { kind: 'sweep' }>>): string {
  const { x0, y0, startAngle, endAngle, extend, transform } = line.gradient;
  const span = endAngle - startAngle;
  const place = (x: number, y: number) =>
    `${formatNumber(transform.a * x + transform.c * y + transform.e)} ${formatNumber(transform.b * x + transform.d * y + transform.f)}`;
  const point = (angle: number) =>
    place(x0 + Math.cos(angle) * SWEEP_RADIUS_EM, y0 + Math.sin(angle) * SWEEP_RADIUS_EM);
  const centre = place(x0, y0);
  const wedges: string[] = [];
  for (let index = 0; index < SWEEP_WEDGES; index += 1) {
    const from = (index / SWEEP_WEDGES) * Math.PI * 2;
    const to = ((index + 1) / SWEEP_WEDGES) * Math.PI * 2;
    const middle = (from + to) / 2;
    const t = span === 0 ? 0 : extended((middle - startAngle) / span, extend);
    const d = `M ${centre} L ${point(from)} L ${point(to)} Z`;
    wedges.push(`<path d="${d}" ${fillAttributes(colourAtStops(line.stops, t))}/>`);
  }
  return wedges.join('');
}
