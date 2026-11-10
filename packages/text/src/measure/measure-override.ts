import {
  resolveInstance,
  virtualObjectId,
  type Board,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import { BUNDLED_FONTS_FINGERPRINT } from '../bundled/fonts-fingerprint.js';

import { measureObjectText } from './measure-object.js';
import { measuringFontsFor, type UnknownFamily } from './measure-text.js';
import type { TextShaping } from './text-shaping.js';

/**
 * An instance whose records hide nothing: each record says `isHidden: false`, and so does a record
 * at every path in `paths`, so a variant preset hiding one of them is overruled too (an own or
 * outer record composes over a preset). Deleting `isHidden` instead would let a preset
 * that hides the child win over the instance's own `isHidden: false`.
 *
 * @param overrides - The records.
 * @param instance - The instance.
 * @param paths - The measured child's path and its ancestors' paths, to show whatever presets say.
 * @returns A copy of the instance; neither input is changed.
 */
function shown(
  overrides: Readonly<Record<string, object>>,
  instance: InstanceObject,
  paths: readonly string[] = [],
): InstanceObject {
  const visible: Record<string, object> = Object.fromEntries(
    Object.entries(overrides).map(([key, fields]) => [key, { ...fields, isHidden: false }]),
  );
  for (const path of paths) visible[path] = { ...visible[path], isHidden: false };
  return { ...instance, overrides: visible };
}

/**
 * The override paths of the measured child and of every container above it, at each level of
 * nesting: in each main, the object at that level and its ancestors up to the main, prefixed by
 * the nested instances' path.
 *
 * @param board - The board.
 * @param path - The child's override path.
 * @returns The paths, the child's last.
 */
function chainPaths(board: Board, path: string): string[] {
  const paths: string[] = [];
  let prefix = '';
  for (const segment of path.split('/')) {
    const chain: string[] = [];
    const seen = new Set<ObjectId>();
    let at = board.objects.get(segment as ObjectId);
    while (at !== undefined && at.type !== 'component' && !seen.has(at.id)) {
      seen.add(at.id);
      chain.unshift(at.id);
      at = at.parentId === null ? undefined : board.objects.get(at.parentId);
    }
    paths.push(...chain.map((id) => `${prefix}${id}`));
    prefix = `${prefix}${segment}/`;
  }
  return paths;
}

/** The text size measured for an instance's override, and the families measured in another face. */
export interface OverrideMeasurement {
  /** The size to store in the record, with the bundled-font fingerprint it was measured with. */
  readonly measuredSize: {
    /** The text's width at the child's own box, world units. */
    readonly width: number;
    /** Its height, world units. */
    readonly height: number;
    /** The bundled-font fingerprint it was measured with (`BUNDLED_FONTS_FINGERPRINT`). */
    readonly fonts: string;
  };
  /** Families the bundled fonts lack, each with the family it was measured in. */
  readonly unknownFamilies: readonly UnknownFamily[];
}

/**
 * Measures the text an instance's record gives a text or sticky child (decision 3): the
 * source child at its own box, with `record` at that path in place of the instance's own (pass
 * the instance's own record merged with new fields, as `setInstanceOverride` merges them),
 * measured as the app lays text out with the bundled fonts, whether or not an override (the
 * instance's or a nested instance's) hides it or an ancestor: shown or not, the text measures
 * the same, so unhiding it later shows a measured size. The size carries
 * `BUNDLED_FONTS_FINGERPRINT`, so a later font change marks it stale. MCP's
 * `set_instance_override` and the app's override size follower both measure here, so every
 * writer stores the same size. Pure: the board is not changed.
 *
 * @param board - The board.
 * @param instance - The instance.
 * @param path - The child's override path.
 * @param record - The record to measure with at that path.
 * @param shaping - Shapes the text with HarfBuzz; without it, per-codepoint metrics.
 * @returns The measurement, or `undefined` when the child is not a text or sticky, or the
 *   instance does not resolve it.
 */
export function measureOverrideText(
  board: Board,
  instance: InstanceObject,
  path: string,
  record: Partial<OverrideRecord>,
  shaping?: TextShaping,
): OverrideMeasurement | undefined {
  const source = board.objects.get(path.split('/').at(-1) as ObjectId);
  if (source?.type !== 'text' && source?.type !== 'sticky') return undefined;
  const objects = new Map(board.objects);
  for (const nestedId of path.split('/').slice(0, -1)) {
    const nested = objects.get(nestedId as ObjectId);
    if (nested?.type === 'instance') objects.set(nested.id, shown(nested.overrides, nested));
  }
  const candidate = shown(
    { ...instance.overrides, [path]: record },
    instance,
    chainPaths(board, path),
  );
  const shownId = virtualObjectId(instance.id, path);
  // Its effective records: variant presets composed under its own.
  const copy = resolveInstance({ ...board, objects }, candidate).objects.find(
    ({ id }) => id === shownId,
  );
  if (copy?.type !== 'text' && copy?.type !== 'sticky') return undefined;
  // Its own box: the instance's constraints and layout do not size the text it measures.
  const measurable = { ...copy, width: source.width, height: source.height };
  const { fonts, unknownFamilies } = measuringFontsFor([measurable.runs]);
  const box = measureObjectText(measurable, fonts, shaping?.measurerFor(fonts))?.box;
  if (box === undefined) return undefined;
  return {
    measuredSize: { width: box.width, height: box.height, fonts: BUNDLED_FONTS_FINGERPRINT },
    unknownFamilies,
  };
}
