import {
  MAX_SHADOW_BLUR,
  MAX_SHADOW_LAYERS,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
} from '../fields/shadow.js';

import type { PaintValueFinding } from './paint-values.js';

// The door's judgement of a drop shadow: the `shadow` member of a `style` value a
// peer writes, judged as `shadowSchema` would accept it, from a value that may be anything. A
// plain value reaches the door, never a parsed one, so the check is by hand, cheap, and names
// the first field at fault, as `paintReason` does for paints. Pure.

/** The keys a shadow holds, and no other. */
const SHADOW_KEYS = ['x', 'y', 'blur', 'spread', 'color'] as const;

/** The closed range each number of a shadow lies in. */
const RANGES: readonly (readonly [string, number, number])[] = [
  ['x', -MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET],
  ['y', -MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET],
  ['blur', 0, MAX_SHADOW_BLUR],
  ['spread', -MAX_SHADOW_SPREAD, MAX_SHADOW_SPREAD],
];

/**
 * Judges one number against a closed range.
 *
 * @param value - The value.
 * @param min - The least it may be.
 * @param max - The most it may be.
 * @param field - Its path.
 * @returns The finding, or undefined.
 */
function numberFinding(
  value: unknown,
  min: number,
  max: number,
  field: string,
): PaintValueFinding | undefined {
  if (typeof value !== 'number') return { field, reason: 'not-a-number' };
  if (!Number.isFinite(value)) return { field, reason: 'not-finite' };
  return value < min || value > max ? { field, reason: 'out-of-range' } : undefined;
}

/**
 * Judges a shadow's colour: a tuple of four numbers in [0, 1] (`'ink'` is refused).
 *
 * @param color - The value.
 * @returns The finding, or undefined.
 */
function colorFinding(color: unknown): PaintValueFinding | undefined {
  if (!Array.isArray(color) || color.length !== 4) {
    return { field: 'color', reason: 'not-a-record' };
  }
  for (let channel = 0; channel < 4; channel += 1) {
    const finding = numberFinding(
      (color as readonly unknown[])[channel],
      0,
      1,
      `color.${String(channel)}`,
    );
    if (finding !== undefined) return finding;
  }
  return undefined;
}

/**
 * The door's judgement of a shape's or frame's drop shadow as a peer wrote it:
 * absent, null, a list of 1 to 8 such shadows, or a strict `{ x, y, blur, spread, color }` with `x` and `y` in [−1000, 1000],
 * `blur` in [0, 500], `spread` in [−500, 500] and `color` a tuple of four numbers in [0, 1].
 * Anything else is refused: a missing or unknown key, a string, `NaN`, an infinity, `'ink'`. The
 * engine's reader applies the same judgement, so a value that skipped the door draws no shadow.
 * Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The first refused field (`''` for the value itself), or undefined when acceptable.
 */
export function shadowValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return shadowLayersReason(value as readonly unknown[]);
  return singleShadowReason(value);
}

/**
 * The door's judgement of a list of shadow layers: 1 to {@link MAX_SHADOW_LAYERS}
 * shadows, each judged as one.
 *
 * @param layers - The list as written.
 * @returns The first refused field (`'<index>.<field>'`), or undefined when acceptable.
 */
function shadowLayersReason(layers: readonly unknown[]): PaintValueFinding | undefined {
  if (layers.length === 0 || layers.length > MAX_SHADOW_LAYERS) {
    return { field: '', reason: 'not-a-record' };
  }
  for (const [index, layer] of layers.entries()) {
    const finding = singleShadowReason(layer);
    if (finding !== undefined) {
      const field = finding.field === '' ? String(index) : `${String(index)}.${finding.field}`;
      return { ...finding, field };
    }
  }
  return undefined;
}

/**
 * The door's judgement of one shadow: a strict `{ x, y, blur, spread, color }` in range.
 *
 * @param value - The value as written.
 * @returns The first refused field, or undefined when acceptable.
 */
function singleShadowReason(value: unknown): PaintValueFinding | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { field: '', reason: 'not-a-record' };
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  const isExact =
    keys.length === SHADOW_KEYS.length && SHADOW_KEYS.every((key) => Object.hasOwn(record, key));
  if (!isExact) return { field: '', reason: 'not-a-record' };
  for (const [name, min, max] of RANGES) {
    const finding = numberFinding(record[name], min, max, name);
    if (finding !== undefined) return finding;
  }
  return colorFinding(record.color);
}
