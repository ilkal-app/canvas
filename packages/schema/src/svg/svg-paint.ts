// SVG paints: `none`, colours, `currentColor`, and references to gradients and
// patterns, resolved for one element. Gradients are mapped onto the board's by `svg-gradient.ts`.
// Pure.
import type { Rgba } from '../fields/color.js';

import { excerpt, readColor } from './svg-values.js';
import type { SvgElement } from './svg-xml.js';

/** Something the import drew differently from the SVG, or left out: reported to the caller. */
export interface SvgIssue {
  /** The SVG feature, e.g. `filter`, `pattern`, `stroke-linejoin`. */
  readonly feature: string;
  /** What was done instead. */
  readonly detail: string;
}

/** A paint as an SVG property resolves it. */
export type ResolvedPaint =
  | { readonly kind: 'none' }
  | { readonly kind: 'color'; readonly color: Rgba }
  | { readonly kind: 'gradient'; readonly element: SvgElement }
  | { readonly kind: 'unsupported'; readonly issue: SvgIssue; readonly fallback: Rgba | null };

/** The gradient elements a paint can reference. */
export const GRADIENTS = new Set(['linearGradient', 'radialGradient']);
const URL = /^url\(\s*(['"]?)#([^'")]+)\1\s*\)\s*(.*)$/;

/**
 * Resolves a paint without a reference: `none`, `currentColor` or a colour. A fallback after
 * `url(…)` is one of these, never another reference, so it is read once.
 *
 * @param value - The value, trimmed.
 * @param currentColor - What `currentColor` is for this element.
 * @returns The paint.
 */
function plainPaint(value: string, currentColor: Rgba): ResolvedPaint {
  const lower = value.toLowerCase();
  if (lower === 'none') return { kind: 'none' };
  if (lower === 'currentcolor') return { kind: 'color', color: currentColor };
  const color = readColor(value);
  if (color !== undefined) return { kind: 'color', color };
  return {
    kind: 'unsupported',
    issue: {
      feature: 'paint',
      detail: `"${excerpt(value)}" is not a colour the board reads; not drawn`,
    },
    fallback: null,
  };
}

/**
 * Resolves a paint value (`fill` or `stroke`): a plain paint, or `url(#id)` with an optional
 * plain fallback.
 *
 * @param value - The computed value.
 * @param currentColor - What `currentColor` is for this element.
 * @param ids - The document's elements by id.
 * @returns The paint.
 */
export function resolvePaint(
  value: string,
  currentColor: Rgba,
  ids: ReadonlyMap<string, SvgElement>,
): ResolvedPaint {
  const trimmed = value.trim();
  const reference = URL.exec(trimmed);
  if (reference === null) return plainPaint(trimmed, currentColor);
  const id = String(reference[2]);
  const fallbackValue = String(reference[3]);
  const target = ids.get(id);
  if (target !== undefined && GRADIENTS.has(target.name)) {
    return { kind: 'gradient', element: target };
  }
  const fallback = fallbackValue === '' ? undefined : plainPaint(fallbackValue, currentColor);
  if (target?.name === 'pattern') {
    const fallbackColor = fallback?.kind === 'color' ? fallback.color : null;
    const detail = fallbackColor === null ? 'not drawn' : 'drawn with its fallback colour';
    return { kind: 'unsupported', issue: { feature: 'pattern', detail }, fallback: fallbackColor };
  }
  if (fallback !== undefined) return fallback;
  return {
    kind: 'unsupported',
    issue: { feature: 'paint reference', detail: `#${excerpt(id)} is not a gradient; not drawn` },
    fallback: null,
  };
}
