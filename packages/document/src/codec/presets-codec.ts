import * as Y from 'yjs';

import { overrideRecordSchema, parsePresetKey, type VariantAxis } from '@canvas/schema';

import { createOverrideMap, writeOverrideMap } from './override-codec.js';

// A main's variant presets: a `Y.Map` from preset key (`axis=value`) to an override
// `Y.Map` from path to plain record, the override codec one level deeper, so edits to different
// presets, or to different paths of one preset, merge.

/** Override records by path, per preset key. */
type Presets = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Builds a detached presets map.
 *
 * @param presets - Validated presets.
 * @returns A map ready to insert under the main's own presets key.
 */
export function createPresetsMap(presets: Presets): Y.Map<unknown> {
  return new Y.Map(
    Object.entries(presets).map(([key, records]) => [key, createOverrideMap(records)]),
  );
}

/**
 * Writes only changed presets and, inside a kept preset, only changed paths, preserving
 * concurrent edits elsewhere.
 *
 * @param map - The integrated presets map.
 * @param presets - The desired validated presets.
 */
export function writePresetsMap(map: Y.Map<unknown>, presets: Presets): void {
  for (const key of map.keys()) {
    if (!Object.hasOwn(presets, key)) map.delete(key);
  }
  for (const [key, records] of Object.entries(presets)) {
    const existing = map.get(key);
    if (existing instanceof Y.Map) writeOverrideMap(existing as Y.Map<unknown>, records);
    else map.set(key, createOverrideMap(records));
  }
}

/**
 * Reads the presets a main's axes can use. An entry that is not a map, a key that names no value
 * of `axes`, or a record that is not a valid override record is skipped on its own, as a peer may
 * have written anything; the rest are kept. A main without axes reads as having no presets
 * (`undefined`): one person removing its variants while another set its axes can leave the presets
 * key without the axes, and presets without axes are not a main the schema admits.
 *
 * @param value - The stored presets field.
 * @param axes - The main's decoded axes, if any.
 * @returns The readable presets, `undefined` for none, or the reason none can be read.
 */
export function readPresetsMap(
  value: unknown,
  axes: readonly VariantAxis[] | undefined,
): Presets | string | undefined {
  if (!(value instanceof Y.Map)) return 'the variant presets are not a keyed map';
  if (axes === undefined) return undefined;
  const presets: Record<string, Record<string, unknown>> = {};
  for (const [key, preset] of value as Y.Map<unknown>) {
    const parsed = parsePresetKey(key);
    const axis = axes.find(({ name }) => name === parsed?.axis);
    if (parsed === undefined || axis?.values.includes(parsed.value) !== true) continue;
    if (!(preset instanceof Y.Map)) continue;
    const records: Record<string, unknown> = {};
    for (const [path, record] of preset as Y.Map<unknown>) {
      if (record instanceof Y.AbstractType) continue;
      if (overrideRecordSchema.safeParse(record).success) records[path] = record;
    }
    presets[key] = records;
  }
  return presets;
}
