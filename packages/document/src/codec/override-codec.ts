import * as Y from 'yjs';

import { overrideRecordSchema } from '@canvas/schema';

import { setIfChanged } from './plain-value.js';

/** One plain replacement record per descendant path; paths are independent CRDT keys. */
type OverrideRecords = Readonly<Record<string, unknown>>;

/**
 * Builds a detached map of overrides without copying children into the document.
 *
 * @param records - Validated override records by source path.
 * @returns A map ready to insert under the instance's own overrides key.
 */
export function createOverrideMap(records: OverrideRecords): Y.Map<unknown> {
  return new Y.Map(Object.entries(records));
}

/**
 * Writes only changed descendant paths, preserving concurrent overrides of other children.
 *
 * @param map - The integrated override map.
 * @param records - The desired validated records.
 */
export function writeOverrideMap(map: Y.Map<unknown>, records: OverrideRecords): void {
  for (const key of map.keys()) {
    if (!Object.hasOwn(records, key)) map.delete(key);
  }
  for (const [key, record] of Object.entries(records)) setIfChanged(map, key, record);
}

/**
 * Reads plain override records. A plain record that is not a valid override record (a peer may
 * have written anything) is skipped on its own and its neighbours kept, as a preset's
 * are (`presets-codec.ts`). The object's regular plain-value check rejects nested shared values,
 * and local commands validate the property vocabulary and source-path target.
 *
 * @param value - The stored overrides field.
 * @returns Plain records, or the reason this instance cannot be read.
 */
export function readOverrideMap(value: unknown): OverrideRecords | string {
  if (!(value instanceof Y.Map)) return 'the overrides are not a keyed map';
  const entries: [string, unknown][] = [];
  for (const [key, record] of value as Y.Map<unknown>) {
    if (
      typeof record !== 'object' ||
      record === null ||
      Array.isArray(record) ||
      record instanceof Y.AbstractType
    ) {
      return `override ${key} is not a plain record`;
    }
    if (overrideRecordSchema.safeParse(record).success) entries.push([key, record]);
  }
  return Object.fromEntries(entries);
}
