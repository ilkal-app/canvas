// The computed style of an SVG element: presentation attributes, overridden by the
// `style` attribute's declarations, inherited from the parent where SVG inherits them. `<style>`
// sheets are not read (the import reports them). Only the properties the import draws or reports
// are computed. Pure.
import type { SvgElement } from './svg-xml.js';

/** The properties an import reads, as computed for one element. */
export interface SvgStyle {
  /** The fill paint as written: `none`, a colour, `currentColor` or `url(#id) [fallback]`. */
  readonly fill: string;
  /** The fill's opacity, 0 to 1. */
  readonly fillOpacity: number;
  /** The fill rule. */
  readonly fillRule: 'nonzero' | 'evenodd';
  /** The stroke paint as written. */
  readonly stroke: string;
  /** The stroke width, as written (a user-unit length is expected). */
  readonly strokeWidth: string;
  /** The stroke's opacity, 0 to 1. */
  readonly strokeOpacity: number;
  /** The stroke's line cap. */
  readonly strokeLinecap: string;
  /** The stroke's line join. */
  readonly strokeLinejoin: string;
  /** The stroke's miter limit. */
  readonly strokeMiterlimit: number;
  /** The stroke's dash array, as written. */
  readonly strokeDasharray: string;
  /** The stroke's dash offset, as written. */
  readonly strokeDashoffset: string;
  /** The colour `currentColor` stands for, as written. */
  readonly color: string;
  /** `visible`, `hidden` or `collapse`. */
  readonly visibility: string;
  /** Whether the stroke ignores transforms (`vector-effect: non-scaling-stroke`); not inherited. */
  readonly isNonScalingStroke: boolean;
  /** Any marker property that is not `none`. */
  readonly marker: string;
  /** The element's own opacity, 0 to 1; not inherited. */
  readonly opacity: number;
  /** The element's own `display`; not inherited. */
  readonly display: string;
  /** The element's own `filter`, `mask` and `clip-path` that are not `none`; not inherited. */
  readonly effects: readonly string[];
  /** The element's own `clip-path`, as written; not inherited. */
  readonly clipPath: string;
}

/** The style of the root's parent: SVG's initial values. */
export const INITIAL_STYLE: SvgStyle = {
  fill: 'black',
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: 'none',
  strokeWidth: '1',
  strokeOpacity: 1,
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 4,
  strokeDasharray: 'none',
  strokeDashoffset: '0',
  color: 'black',
  visibility: 'visible',
  isNonScalingStroke: false,
  marker: 'none',
  opacity: 1,
  display: 'inline',
  effects: [],
  clipPath: 'none',
};

/**
 * The declarations of a `style` attribute, by lowercase property name; `!important` dropped.
 *
 * @param style - The attribute, or undefined.
 * @returns The declarations.
 */
function declarations(style: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of (style ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim();
    if (name !== '' && value !== '') result.set(name, value);
  }
  return result;
}

/**
 * Reads an opacity: a number or percentage, clamped to [0, 1].
 *
 * @param value - The value.
 * @param fallback - What an unreadable value computes to.
 * @returns The opacity.
 */
function opacityOf(value: string, fallback: number): number {
  const trimmed = value.trim();
  const number = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return trimmed === '' || Number.isNaN(number) ? fallback : Math.min(1, Math.max(0, number));
}

/**
 * Computes an element's style from its parent's.
 *
 * @param element - The element.
 * @param parent - The parent's computed style ({@link INITIAL_STYLE} for the root).
 * @returns The element's computed style.
 */
export function computeStyle(element: SvgElement, parent: SvgStyle): SvgStyle {
  const declared = declarations(element.attributes.get('style'));
  const read = (name: string): string | undefined => {
    const value = declared.get(name) ?? element.attributes.get(name)?.trim();
    return value === 'inherit' ? undefined : value;
  };
  const effects = ['filter', 'mask', 'clip-path'].filter((name) => {
    const value = read(name);
    return value !== undefined && value !== 'none';
  });
  const markers = ['marker', 'marker-start', 'marker-mid', 'marker-end']
    .map(read)
    .find((value) => value !== undefined && value !== 'none');
  const fillRule = read('fill-rule');
  const miterlimit = Number(read('stroke-miterlimit') ?? Number.NaN);
  const vectorEffect = read('vector-effect');
  return {
    fill: read('fill') ?? parent.fill,
    fillOpacity: opacityOf(read('fill-opacity') ?? '', parent.fillOpacity),
    fillRule: fillRule === 'evenodd' || fillRule === 'nonzero' ? fillRule : parent.fillRule,
    stroke: read('stroke') ?? parent.stroke,
    strokeWidth: read('stroke-width') ?? parent.strokeWidth,
    strokeOpacity: opacityOf(read('stroke-opacity') ?? '', parent.strokeOpacity),
    strokeLinecap: read('stroke-linecap') ?? parent.strokeLinecap,
    strokeLinejoin: read('stroke-linejoin') ?? parent.strokeLinejoin,
    strokeMiterlimit: miterlimit >= 1 ? miterlimit : parent.strokeMiterlimit,
    strokeDasharray: read('stroke-dasharray') ?? parent.strokeDasharray,
    strokeDashoffset: read('stroke-dashoffset') ?? parent.strokeDashoffset,
    color: read('color') ?? parent.color,
    visibility: read('visibility') ?? parent.visibility,
    isNonScalingStroke: vectorEffect === 'non-scaling-stroke',
    marker: markers ?? parent.marker,
    opacity: opacityOf(read('opacity') ?? '', 1),
    display: read('display') ?? 'inline',
    effects,
    clipPath: read('clip-path') ?? 'none',
  };
}

/**
 * Reads a single property of an element that is not inherited and not part of {@link SvgStyle}
 * (a gradient stop's `stop-color`, `stop-opacity`): the `style` declaration, else the attribute.
 *
 * @param element - The element.
 * @param name - The property.
 * @returns The value, or undefined.
 */
export function ownProperty(element: SvgElement, name: string): string | undefined {
  return declarations(element.attributes.get('style')).get(name) ?? element.attributes.get(name);
}
