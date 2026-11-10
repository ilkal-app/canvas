import type { BoardObject } from '../objects/board-object.js';

/** A plain record view of an object's fields while lengths are scaled. */
type Fields = Record<string, unknown>;

/**
 * Tells whether a value is a non-array object.
 *
 * @param value - Any value.
 * @returns Whether it is a record.
 */
function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Scales the named numeric fields of a record, leaving the rest as they are.
 *
 * @param value - A record, or anything else (returned as it is).
 * @param keys - The length fields to multiply.
 * @param scale - The factor.
 * @returns A new record with those fields scaled.
 */
function scaledFields(value: unknown, keys: readonly string[], scale: number): unknown {
  if (!isRecord(value)) return value;
  const out: Fields = { ...value };
  for (const key of keys) {
    const field = out[key];
    if (typeof field === 'number') out[key] = field * scale;
  }
  return out;
}

/**
 * Scales a `{ unit, value }` length when its unit is absolute (`px`); a percent stays.
 *
 * @param value - A letter spacing or line height, or undefined.
 * @param scale - The factor.
 * @returns The scaled length.
 */
function scaledUnitLength(value: unknown, scale: number): unknown {
  return isRecord(value) && value.unit === 'px' ? scaledFields(value, ['value'], scale) : value;
}

/**
 * Scales a run list's font sizes and absolute letter spacing and line height.
 *
 * @param runs - A text's style runs.
 * @param scale - The factor.
 * @returns New runs.
 */
function scaledRuns(runs: unknown, scale: number): unknown {
  if (!Array.isArray(runs)) return runs;
  return runs.map((run: unknown) => {
    if (!isRecord(run) || !isRecord(run.style)) return run;
    const style: Fields = { ...run.style };
    if (typeof style.fontSize === 'number') style.fontSize *= scale;
    if (style.letterSpacing !== undefined)
      style.letterSpacing = scaledUnitLength(style.letterSpacing, scale);
    if (style.lineHeight !== undefined)
      style.lineHeight = scaledUnitLength(style.lineHeight, scale);
    return { ...run, style };
  });
}

/**
 * Scales a shadow value: one layer or a list of layers.
 *
 * @param shadow - A shadow field.
 * @param scale - The factor.
 * @returns The scaled shadow.
 */
function scaledShadow(shadow: unknown, scale: number): unknown {
  const keys = ['x', 'y', 'blur', 'spread'];
  return Array.isArray(shadow)
    ? shadow.map((layer: unknown) => scaledFields(layer, keys, scale))
    : scaledFields(shadow, keys, scale);
}

/**
 * Scales an auto-layout's gap and padding; its modes stay.
 *
 * @param layout - An auto-layout or override patch.
 * @param scale - The factor.
 * @returns The scaled layout.
 */
function scaledAutoLayout(layout: unknown, scale: number): unknown {
  if (!isRecord(layout)) return layout;
  const out = scaledFields(layout, ['gap'], scale) as Fields;
  if (layout.padding !== undefined)
    out.padding = scaledFields(layout.padding, ['top', 'right', 'bottom', 'left'], scale);
  return out;
}

/** How each length-bearing field of an object scales, by field name. */
const FIELD_SCALERS: Readonly<Record<string, (value: unknown, scale: number) => unknown>> = {
  cornerRadius: (value, scale) =>
    Array.isArray(value)
      ? value.map((radius: number) => radius * scale)
      : (value as number) * scale,
  stroke: (value, scale) => scaledFields(value, ['width'], scale),
  strokeDash: (value, scale) =>
    isRecord(value)
      ? {
          ...(scaledFields(value, ['offset'], scale) as Fields),
          pattern: (value.pattern as number[]).map((length) => length * scale),
        }
      : value,
  shadow: scaledShadow,
  runs: scaledRuns,
  label: (value, scale) =>
    isRecord(value) ? { ...value, runs: scaledRuns(value.runs, scale) } : value,
  autoLayout: scaledAutoLayout,
  points: (value, scale) =>
    (value as unknown[]).map((point) => scaledFields(point, ['x', 'y'], scale)),
  vertices: (value, scale) =>
    (value as unknown[]).map((vertex) => scaledFields(vertex, ['x', 'y'], scale)),
  segments: (value, scale) =>
    (value as unknown[]).map((segment) =>
      isRecord(segment)
        ? {
            ...segment,
            ha: scaledFields(segment.ha, ['x', 'y'], scale),
            hb: scaledFields(segment.hb, ['x', 'y'], scale),
          }
        : segment,
    ),
  from: (value, scale) =>
    isRecord(value) && value.kind === 'point' ? scaledFields(value, ['x', 'y'], scale) : value,
  to: (value, scale) =>
    isRecord(value) && value.kind === 'point' ? scaledFields(value, ['x', 'y'], scale) : value,
};

/**
 * An object drawn `scale` times larger about its parent's origin: its position, size,
 * vertices and points, stroke widths and dashes, corner radii, font sizes and absolute text
 * spacing, shadow offsets, blur and spread, auto-layout gap and padding, and a nested instance's
 * own `scale` (so its content draws as much larger) are multiplied. Colours, opacity, rotation,
 * ids, unitless values (percent spacing, miter limits, image crops and natural sizes) and an
 * instance's override records (in its main's units) stay. Used
 * for the virtual copies of a scaled instance's content; pure, and scale 1 returns the object.
 *
 * @param object - A board object in its parent's frame.
 * @param scale - The factor, above 0.
 * @returns A new object, or `object` itself when `scale` is 1.
 */
export function scaledObject<Type extends BoardObject>(object: Type, scale: number): Type {
  if (scale === 1) return object;
  const out: Fields = scaledFields(object, ['x', 'y', 'width', 'height'], scale) as Fields;
  for (const [key, scaler] of Object.entries(FIELD_SCALERS)) {
    const value = out[key];
    if (value !== undefined && value !== null) out[key] = scaler(value, scale);
  }
  // A nested instance's copy draws its content larger by the factor too: its own
  // scale composes (absent is 1), so a stored copy, a detach's, draws as the copy does. Its
  // override records stay in its main's units.
  if (object.type === 'instance') out.scale = (object.scale ?? 1) * scale;
  return out as Type;
}
