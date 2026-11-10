import { z } from 'zod';

import {
  mergeOverrideRecords,
  overrideRecordSchema,
  parsePresetKey,
  type BoardObject,
  type ComponentObject,
  type InstanceOverrides,
  type PresetKeyParts,
} from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { overridePathError, overridePathInputSchema } from './override-path-names.js';
import {
  presetRecordError,
  resolvePresetPath,
  unknownVariantError,
} from './variant-command-checks.js';

// Presets given with an axes write: a variant set's records arrive with its axes, in
// one command, so a set is made, or a value added with its preset, in one call and one undo step.

/** A key a parsed record would drop without a word: an object's own `__proto__`. */
const PROTO_KEY = '__proto__';

/**
 * The paths of own `__proto__` keys in given presets, as preset keys or as child paths: a record
 * schema skips such a key, so a child with that id would lose its record without a refusal.
 *
 * @param raw - The input as received.
 * @returns The keys' paths, `[PROTO_KEY]` or `[key, PROTO_KEY]`.
 */
function protoKeyPaths(raw: unknown): string[][] {
  if (raw === null || typeof raw !== 'object') return [];
  const paths: string[][] = Object.hasOwn(raw, PROTO_KEY) ? [[PROTO_KEY]] : [];
  for (const [key, records] of Object.entries(raw as Readonly<Record<string, unknown>>)) {
    if (records !== null && typeof records === 'object' && Object.hasOwn(records, PROTO_KEY)) {
      paths.push([key, PROTO_KEY]);
    }
  }
  return paths;
}

/**
 * Presets given in an axes write: `axis=value` to the records by path, as they are stored. A
 * `__proto__` key is refused rather than dropped.
 */
export const givenPresetsSchema = z
  .preprocess(
    (raw, context) => {
      for (const path of protoKeyPaths(raw)) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'A preset key or child path may not be "__proto__".',
          input: raw,
        });
      }
      return raw;
    },
    z.record(z.string(), z.record(overridePathInputSchema, overrideRecordSchema)),
  )
  .describe(
    'Presets by "axis=value": each the records to merge in by child path (as query_board lists them, or the layers\' names), checked as set_variant_preset checks one.',
  );

/** Presets given in an axes write. */
export type GivenPresets = z.infer<typeof givenPresetsSchema>;

/**
 * A main with presets given in an axes write merged in: each key must name a value of
 * its axes, and each record merges into that preset's record at its path, then is checked as
 * `setVariantPreset` checks one, against the main as it will be. Refused whole: an error's path
 * starts `['variantPresets', key]`, then the record's path.
 *
 * @param board - The board before the command.
 * @param main - The main with its new axes, and presets for every value.
 * @param given - The presets given.
 * @param overlay - Objects the command writes that the main's content reads (a new main's
 *   children, placed in it).
 * @returns The main with the presets merged in, or the refusal.
 */
export function withGivenPresets(
  board: BoardReader,
  main: ComponentObject,
  given: GivenPresets,
  overlay: readonly BoardObject[] = [],
): { readonly main: ComponentObject } | { readonly errors: CommandError[] } {
  const presets: Record<string, InstanceOverrides> = { ...main.variantPresets };
  const errors: CommandError[] = [];
  // Each key's records by id path: a name path read through the main as given.
  const resolved = new Map<
    string,
    { selected: PresetKeyParts; entries: [string, InstanceOverrides[string]][] }
  >();
  for (const [key, records] of Object.entries(given)) {
    const where = ['variantPresets', key];
    const selected = parsePresetKey(key);
    const unknown =
      selected === undefined
        ? commandError('unknown-variant', main.id, where, `${key} is not an axis=value key.`)
        : unknownVariantError(main, selected.axis, selected.value, where);
    if (unknown !== undefined || selected === undefined) {
      if (unknown !== undefined) errors.push(unknown);
      continue;
    }
    const entries: [string, InstanceOverrides[string]][] = [];
    for (const [given, record] of Object.entries(records)) {
      const resolution = resolvePresetPath(board, main, selected, given, overlay);
      if ('error' in resolution)
        errors.push(overridePathError(resolution, main.id, [...where, given]));
      else entries.push([resolution.path, record]);
    }
    resolved.set(key, { selected, entries });
    const preset: Record<string, InstanceOverrides[string]> = { ...presets[key] };
    for (const [path, record] of entries) {
      preset[path] = mergeOverrideRecords(preset[path], record);
    }
    presets[key] = preset;
  }
  if (errors.length > 0) return { errors };
  const next: ComponentObject = { ...main, variantPresets: presets };
  for (const [key, { selected, entries }] of resolved) {
    for (const [path, record] of entries) {
      const refused = presetRecordError(board, next, selected, path, record, overlay);
      if (refused !== undefined) errors.push({ ...refused, path: ['variantPresets', key, path] });
    }
  }
  return errors.length > 0 ? { errors } : { main: next };
}
