import type { StylePatch } from '@canvas/document';
import type { StrokeCap, StrokeDash } from '@canvas/schema';

/** A dash the Dash list offers, or a pattern none of them makes. */
export type DashKind = 'solid' | 'dashed' | 'dotted' | 'custom';

/** A dash preset: Dashed or Dotted. */
export type DashPreset = 'dashed' | 'dotted';

/**
 * The dash presets, in stroke widths, so a thicker stroke gets longer dashes: dashed is 4 on and
 * 4 off; dotted is dashes of length 0, 2 apart, which round or square caps draw as dots.
 */
export const DASH_PRESETS: Readonly<Record<DashPreset, readonly number[]>> = {
  dashed: [4, 4],
  dotted: [0, 2],
};

/**
 * The stroke a dash choice is made for: a selected path, line or connector, or a creation tool's
 * style.
 */
export interface DashTarget {
  /** Its stroke's width, world px; undefined without a stroke. */
  readonly width: number | undefined;
  /** Its cap now; undefined draws round. */
  readonly strokeCap: StrokeCap | undefined;
}

/**
 * The width a preset's lengths are scaled by: the stroke's, at least 1 (a path without a stroke
 * still gets a valid pattern). Pure.
 *
 * @param width - The stroke's width, or undefined without one.
 * @returns The width, world px.
 */
export function presetWidth(width: number | undefined): number {
  return Math.max(width ?? 1, 1);
}

/**
 * A preset's dash for a stroke width. Pure.
 *
 * @param preset - The preset.
 * @param width - The stroke's width, or undefined without one.
 * @returns The dash.
 */
export function presetDash(preset: DashPreset, width: number | undefined): StrokeDash {
  const scale = presetWidth(width);
  return { pattern: DASH_PRESETS[preset].map((length) => length * scale) };
}

/**
 * Which preset a dash is at a stroke width, if any: none (or null) is solid. Pure.
 *
 * @param dash - The dash, or null or undefined for none.
 * @param width - The stroke's width, or undefined without one.
 * @returns The kind.
 */
export function dashKindOf(
  dash: StrokeDash | null | undefined,
  width: number | undefined,
): DashKind {
  if (dash === undefined || dash === null) return 'solid';
  for (const preset of ['dashed', 'dotted'] as const) {
    const { pattern } = presetDash(preset, width);
    const isSame =
      (dash.offset ?? 0) === 0 &&
      dash.pattern.length === pattern.length &&
      dash.pattern.every((length, index) => length === pattern[index]);
    if (isSame) return preset;
  }
  return 'custom';
}

/**
 * The patch a Dash choice sets on a stroke: null for solid, a preset scaled by its width; a
 * dotted stroke with butt caps gets round ones, since butt caps draw a dash of length 0 as
 * nothing. Custom, which is shown and not chosen, sets nothing. Pure.
 *
 * @param kind - The choice.
 * @param target - The stroke's width and cap.
 * @returns The patch.
 */
export function dashPatch(kind: string, target: DashTarget): StylePatch {
  if (kind === 'solid') return { strokeDash: null };
  if (kind !== 'dashed' && kind !== 'dotted') return {};
  const strokeDash = presetDash(kind, target.width);
  return kind === 'dotted' && target.strokeCap === 'butt'
    ? { strokeDash, strokeCap: 'round' }
    : { strokeDash };
}
