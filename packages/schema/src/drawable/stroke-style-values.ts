import {
  MAX_STROKE_DASH_ENTRIES,
  MAX_STROKE_DASH_LENGTH,
  MAX_STROKE_DASH_OFFSET,
  MAX_STROKE_MITER_LIMIT,
  STROKE_CAPS,
  STROKE_JOINS,
} from '../fields/stroke-style.js';

import type { PaintValueFinding } from './paint-values.js';

// The door's judgement of a stroke style: the `strokeDash`,
// `strokeJoin`, `strokeMiterLimit` and `strokeCap` members of a `style` value a peer writes,
// judged as `strokeStyleFields` would accept them, from a value that may be anything. A plain
// value reaches the door, never a parsed one, so each check is by hand and names the first field
// at fault. None of them is a colour, so `ink` is refused everywhere here. Pure.

/** The joins the engine draws. */
const JOINS: ReadonlySet<unknown> = new Set(STROKE_JOINS);

/** The caps the engine draws. */
const CAPS: ReadonlySet<unknown> = new Set(STROKE_CAPS);

/**
 * Builds a finding.
 *
 * @param path - The field's path within the style group.
 * @param reason - Why.
 * @returns The finding.
 */
function at(
  path: readonly (string | number)[],
  reason: PaintValueFinding['reason'],
): PaintValueFinding {
  return { field: path.join('.'), reason };
}

/**
 * Judges a number against a closed range.
 *
 * @param value - The value.
 * @param min - The least allowed.
 * @param max - The most allowed.
 * @param path - Its path.
 * @returns The finding, or undefined.
 */
function numberFinding(
  value: unknown,
  min: number,
  max: number,
  path: readonly (string | number)[],
): PaintValueFinding | undefined {
  if (typeof value !== 'number') return at(path, 'not-a-number');
  if (!Number.isFinite(value)) return at(path, 'not-finite');
  return value < min || value > max ? at(path, 'out-of-range') : undefined;
}

/**
 * Judges a dash pattern's lengths: an array of 1 to 8 numbers in [0, 4096], not all 0.
 *
 * @param pattern - The value.
 * @returns The finding, or undefined.
 */
function patternFinding(pattern: unknown): PaintValueFinding | undefined {
  const path = ['strokeDash', 'pattern'];
  if (!Array.isArray(pattern)) return at(path, 'not-a-record');
  const lengths = pattern as readonly unknown[];
  if (lengths.length < 1 || lengths.length > MAX_STROKE_DASH_ENTRIES) {
    return at(path, 'out-of-range');
  }
  for (const [index, length] of lengths.entries()) {
    const finding = numberFinding(length, 0, MAX_STROKE_DASH_LENGTH, [...path, index]);
    if (finding !== undefined) return finding;
  }
  return lengths.some((length) => (length as number) > 0) ? undefined : at(path, 'out-of-range');
}

/**
 * Judges a dash: absent, null, or a strict `{ pattern, offset? }`.
 *
 * @param dash - The value.
 * @returns The finding, or undefined.
 */
function dashFinding(dash: unknown): PaintValueFinding | undefined {
  if (dash === undefined || dash === null) return undefined;
  if (typeof dash !== 'object' || Array.isArray(dash)) return at(['strokeDash'], 'not-a-record');
  const record = dash as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  const isStrict =
    Object.hasOwn(record, 'pattern') && keys.every((key) => key === 'pattern' || key === 'offset');
  if (!isStrict) return at(['strokeDash'], 'not-a-record');
  return (
    patternFinding(record.pattern) ??
    (record.offset === undefined
      ? undefined
      : numberFinding(record.offset, -MAX_STROKE_DASH_OFFSET, MAX_STROKE_DASH_OFFSET, [
          'strokeDash',
          'offset',
        ]))
  );
}

/**
 * Judges one of a fixed set of names: absent, or one of them.
 *
 * @param value - The value.
 * @param names - The names allowed.
 * @param field - The field.
 * @returns The finding, or undefined.
 */
function choiceFinding(
  value: unknown,
  names: ReadonlySet<unknown>,
  field: string,
): PaintValueFinding | undefined {
  return value === undefined || names.has(value) ? undefined : at([field], 'out-of-range');
}

/**
 * The door's judgement of a style group's stroke style as a peer wrote it: a
 * `strokeDash` absent, null or a strict `{ pattern, offset? }` with 1 to 8 lengths in [0, 4096]
 * world px, not all 0, and an offset within ±32768; a `strokeJoin` absent or `miter`, `round` or
 * `bevel`; a `strokeMiterLimit` absent or in [1, 100]; a `strokeCap` absent or `butt`, `round` or
 * `square`. Anything else is refused: a NaN or infinite length (`not-finite`), a string where a
 * number goes (`not-a-number`), a pattern that is not an array or a dash with an unknown key
 * (`not-a-record`), and a count, length, limit or name outside those (`out-of-range`). Pure.
 *
 * @param style - The style group as written, from any peer; not mutated.
 * @returns The first refused field, its path within the group (`strokeDash.pattern.2`,
 *   `strokeJoin`), or undefined when the stroke style is acceptable.
 */
export function strokeStyleReason(
  style: Readonly<Record<string, unknown>>,
): PaintValueFinding | undefined {
  return (
    dashFinding(style.strokeDash) ??
    choiceFinding(style.strokeJoin, JOINS, 'strokeJoin') ??
    (style.strokeMiterLimit === undefined
      ? undefined
      : numberFinding(style.strokeMiterLimit, 1, MAX_STROKE_MITER_LIMIT, ['strokeMiterLimit'])) ??
    choiceFinding(style.strokeCap, CAPS, 'strokeCap')
  );
}
