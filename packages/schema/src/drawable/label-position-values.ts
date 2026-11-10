import { MAX_CURVE_POINT_REACH } from '../objects/connector-object.js';

import type { PaintValueFinding } from './paint-values.js';

/**
 * Judges a connector's stored `labelPosition`, and its `elbowMiddle`, at the
 * relay's door: absent, or a number from 0 to 1. A raw update that is anything else (NaN, an
 * infinity, a fraction past an end, a string) is refused, as the schema and the commands refuse
 * it. Pure.
 *
 * @param value - The stored value.
 * @returns The finding, or `undefined` when the value may be stored.
 */
export function labelPositionValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') return { field: '', reason: 'not-a-number' };
  return value >= 0 && value <= 1 ? undefined : { field: '', reason: 'out-of-range' };
}

/**
 * Judges a connector's stored `curvePoint` at the relay's door: absent, or a record of
 * exactly `x` and `y`, each a number within {@link MAX_CURVE_POINT_REACH} of 0, as the schema
 * takes it. Pure.
 *
 * @param value - The stored value.
 * @returns The finding, or `undefined` when the value may be stored.
 */
export function curvePointValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { field: '', reason: 'not-a-record' };
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => key !== 'x' && key !== 'y')) {
    return { field: '', reason: 'not-a-record' };
  }
  for (const field of ['x', 'y'] as const) {
    const coordinate = record[field];
    if (typeof coordinate !== 'number') return { field, reason: 'not-a-number' };
    if (!(Math.abs(coordinate) <= MAX_CURVE_POINT_REACH)) return { field, reason: 'out-of-range' };
  }
  return undefined;
}
