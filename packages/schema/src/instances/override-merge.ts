import { withPostScriptName } from '../fields/postscript-name.js';

import type { OverrideRecord } from './instance-overrides.js';

/** Record fields whose values are maps merged key by key rather than replaced whole. */
const KEYED_FIELDS = ['textStyle', 'variant', 'autoLayout'] as const;

/**
 * Whether a record supplies any text field a measured size depends on: `text`, `runs`
 * or a `textStyle` key.
 *
 * @param record - An override record.
 * @returns Whether it changes the measured text.
 */
function suppliesText(record: OverrideRecord): boolean {
  return (
    record.text !== undefined ||
    record.runs !== undefined ||
    (isPlainRecord(record.textStyle) && Object.keys(record.textStyle).length > 0)
  );
}

/**
 * Lays an outer record over an inner one at the same path, field by field, the outer winning.
 * An outer `text` takes its own `runs` or none, so a merged record never pairs one record's
 * characters with the other's runs; two `textStyle`s or two nested `variant`
 * selections merge key by key. A measured size measures the text below it, so
 * an outer record that supplies a text field without its own size drops the inner one: it no
 * longer measures the merged text. Neither record is validated here (the caller reads each
 * first); the merged one is read like any other. Used for nested instances (outer over inner)
 * and for variant presets (a later axis over an earlier one, the instance's own over both).
 *
 * @param inner - The record laid under, if any.
 * @param outer - The record laid over it at the same path.
 * @returns A new record; neither input is changed.
 */
export function mergeOverrideRecords(
  inner: OverrideRecord | undefined,
  outer: OverrideRecord,
): OverrideRecord {
  const merged: Record<string, unknown> = { ...inner, ...outer };
  if (outer.text !== undefined && outer.runs === undefined) Reflect.deleteProperty(merged, 'runs');
  if (outer.measuredSize === undefined && suppliesText(outer)) {
    Reflect.deleteProperty(merged, 'measuredSize');
  }
  for (const field of KEYED_FIELDS) {
    const under: unknown = inner?.[field];
    const over: unknown = outer[field];
    if (isPlainRecord(under) && isPlainRecord(over)) merged[field] = { ...under, ...over };
  }
  // A face belongs to its family: an outer text style that moves to another family
  // without naming a face drops the inner one. An inner face with no family is a face of whatever
  // family the child shows, so it is kept; drawing honours it only within the resolved family.
  const under = inner?.textStyle;
  const over = outer.textStyle;
  if (
    isPlainRecord(under) &&
    isPlainRecord(over) &&
    typeof over.fontFamily === 'string' &&
    over.postScriptName === undefined &&
    typeof under.fontFamily === 'string' &&
    over.fontFamily !== under.fontFamily
  ) {
    merged.textStyle = withPostScriptName(merged.textStyle as object, undefined);
  }
  return merged;
}

/**
 * Tells whether a stored value is a plain record, as a peer may have written anything.
 *
 * @param value - A stored value.
 * @returns True for a non-array object.
 */
export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
