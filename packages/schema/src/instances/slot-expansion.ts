import type { Board } from '../board/board.js';
import type { ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { definitionContent } from './definition-content.js';
import { effectiveOverrides } from './effective-overrides.js';
import { effectiveSlotMain } from './effective-slot-main.js';
import {
  overrideRecordSchema,
  type InstanceOverrides,
  type OverrideRecord,
} from './instance-overrides.js';
import { applyInstanceOverride, instanceOverrideFields } from './override-content.js';
import { mergeOverrideRecords } from './override-merge.js';

// How a nested instance (a slot) is entered while expanding its enclosing instance: its record
// applied, its effective main and the records that reach below it. Resolution and the
// command layer's override paths both enter slots through here, so they follow the same main.
// Pure.

/**
 * Reads one own record defensively; an unreadable remote record does not alter source content.
 *
 * @param overrides - Stored records by path.
 * @param path - The source child path.
 * @returns A validated record, or no override.
 */
export function recordAt(overrides: InstanceOverrides, path: string): OverrideRecord | undefined {
  if (!Object.hasOwn(overrides, path)) return undefined;
  const parsed = overrideRecordSchema.safeParse(overrides[path]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Passes overrides through a nested instance, with outer properties taking precedence
 * ({@link mergeOverrideRecords}).
 *
 * @param instance - The nested source instance.
 * @param outer - Overrides from the enclosing instance, relative to its main.
 * @returns The nested instance's effective relative-path overrides.
 */
function nestedOverrides(instance: InstanceObject, outer: InstanceOverrides): InstanceOverrides {
  const records = new Map(Object.entries(instance.overrides));
  const prefix = `${instance.id}/`;
  for (const path of Object.keys(outer)) {
    if (!path.startsWith(prefix)) continue;
    // Each record is read on its own first: one no reader parses is ignored whole, never
    // completed by the other's fields (an outer `runs` borrowing the inner `text`).
    const record = recordAt(outer, path);
    if (record === undefined) continue;
    const relative = path.slice(prefix.length);
    records.set(relative, mergeOverrideRecords(recordAt(instance.overrides, relative), record));
  }
  return Object.fromEntries(records);
}

/**
 * A layer's name as a name path reads it, as command name paths do: its `name` unless empty, or
 * an unnamed instance's main's name.
 *
 * @param board - The source board.
 * @param object - The layer.
 * @returns The name, or undefined for an unnamed layer.
 */
function layerName(board: Board, object: BoardObject): string | undefined {
  if (object.name !== undefined && object.name !== '') return object.name;
  return object.type === 'instance' ? board.objects.get(object.mainId)?.name : undefined;
}

/**
 * The layer-name path of each child of a main, from its direct child down, as a key that cannot
 * collide however the names read (a JSON list); a child below an unnamed layer has none.
 *
 * @param board - The source board.
 * @param mainId - The main.
 * @param children - An optional existing child index of the whole board.
 * @returns The content in order, each with its key or undefined.
 */
function namePaths(
  board: Board,
  mainId: ObjectId,
  children?: ChildIndex,
): { readonly object: BoardObject; readonly key: string | undefined }[] {
  // The main itself is the empty path; its direct children start there.
  const paths = new Map<ObjectId | null, readonly string[] | undefined>([[mainId, []]]);
  return definitionContent(board, mainId, children).map((object) => {
    const name = layerName(board, object);
    const above = paths.get(object.parentId);
    const path = name === undefined || above === undefined ? undefined : [...above, name];
    paths.set(object.id, path);
    return { object, key: path === undefined ? undefined : JSON.stringify(path) };
  });
}

/**
 * The records below a swapped slot with its definition's records carried over (
 *), as Figma keeps a variant's overrides across a swap. Two kinds carry: the enclosing
 * main's preset records at the slot's stored main's children, and the slot's own stored records
 * (the nested instance's records inside the main: its definition, as `import_document` builds a
 * main whose default variant colours its icon). A record at a child of the stored main that the
 * swapped-in main lacks applies to every child of that main with the same layer-name path, with
 * only the fields that child's type takes; a preset record wins over the slot's own record, field
 * by field, and a record already at the new child (an own or outer record, or one keyed to its
 * id) wins over both. A path naming nothing there, or into a nested instance, carries nothing.
 * The placed instance's own records do not carry: they are the instance's to reset, at the path
 * they were written to.
 *
 * @param board - The source board; not changed.
 * @param slot - The slot, with its stored main and its own stored records.
 * @param mainId - The main it expands.
 * @param overrides - The records below the slot, relative to it.
 * @param presets - The enclosing main's chosen presets, relative to that main.
 * @param children - An optional existing child index of the whole board.
 * @returns The records to expand with; `overrides` itself when nothing carries over.
 */
function carriedOverrides(
  board: Board,
  slot: InstanceObject,
  mainId: ObjectId,
  overrides: InstanceOverrides,
  presets: InstanceOverrides,
  children?: ChildIndex,
): InstanceOverrides {
  const prefix = `${slot.id}/`;
  // The slot's own records first, then the presets, so a preset's fields win.
  const sources: [string, OverrideRecord | undefined][] = [
    ...Object.keys(slot.overrides).map((path): [string, OverrideRecord | undefined] => [
      path,
      recordAt(slot.overrides, path),
    ]),
    ...Object.keys(presets)
      .filter((path) => path.startsWith(prefix))
      .map((path): [string, OverrideRecord | undefined] => [
        path.slice(prefix.length),
        recordAt(presets, path),
      ]),
  ];
  if (sources.length === 0) return overrides;
  const byKey = new Map<string, BoardObject[]>();
  const newIds = new Set<string>();
  for (const { object, key } of namePaths(board, mainId, children)) {
    newIds.add(object.id);
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), object]);
  }
  const keyOf = new Map<string, string | undefined>(
    namePaths(board, slot.mainId, children).map(({ object, key }) => [object.id, key]),
  );
  const carried = new Map<string, OverrideRecord>();
  for (const [relative, record] of sources) {
    const key = keyOf.get(relative);
    if (key === undefined || newIds.has(relative) || record === undefined) continue;
    for (const object of byKey.get(key) ?? []) {
      const allowed = new Set<string>(instanceOverrideFields(object));
      const fitted = Object.fromEntries(
        Object.entries(record).filter(([field]) => allowed.has(field)),
      ) as OverrideRecord;
      carried.set(object.id, mergeOverrideRecords(carried.get(object.id), fitted));
    }
  }
  if (carried.size === 0) return overrides;
  const result: Record<string, OverrideRecord> = { ...overrides };
  for (const [id, record] of carried) {
    result[id] = mergeOverrideRecords(record, recordAt(overrides, id) ?? {});
  }
  return result;
}

/**
 * A nested instance as its enclosing instance expands it: its record in `outer` applied (a
 * nested `variant`), its main the effective one ({@link effectiveSlotMain}: a swap
 * where it can expand), and its overrides the outer records below it merged over its own, with
 * that main's presets composed under them.
 *
 * @param board - The source board; not changed.
 * @param slot - The nested source instance, already placed in the enclosing instance's frame.
 * @param outer - The enclosing instance's effective records, relative to its main.
 * @param ancestorMains - The mains expanded above the slot, outermost first.
 * @param children - An optional existing child index of the whole board.
 * @param presets - For drawing: the enclosing main's chosen presets (possibly none chosen, `{}`).
 * With them, a swapped slot carries its definition's records, those presets' and its own stored
 * ones, to a swapped-in main by layer name. Readers of stored records (command
 * paths, the inspector's own records) pass nothing, and nothing carries.
 * @returns The instance to expand in the slot's place; the inputs are not changed.
 */
export function slotExpansion(
  board: Board,
  slot: InstanceObject,
  outer: InstanceOverrides,
  ancestorMains: readonly ObjectId[],
  children?: ChildIndex,
  presets?: InstanceOverrides,
): InstanceObject {
  const record = recordAt(outer, slot.id);
  const applied =
    record === undefined ? slot : (applyInstanceOverride(slot, record) as typeof slot);
  // A swap expands the record's main where it can; paths below the slot then apply
  // where that main has the child, and the enclosing main's presets at the stored main's children
  // carry over to its children of the same layer-name path. Its selection already took the record's
  // `variant`, carried across a swap by axis name; its main's presets compose under the outer
  // and its own records.
  const mainId = effectiveSlotMain(board, applied, record, ancestorMains, children);
  const swapped = mainId === applied.mainId ? applied : { ...applied, mainId };
  const below = nestedOverrides(swapped, outer);
  const overrides =
    mainId === slot.mainId || presets === undefined
      ? below
      : carriedOverrides(board, slot, mainId, below, presets, children);
  const nested = { ...swapped, overrides };
  const main = board.objects.get(mainId);
  return main?.type === 'component'
    ? { ...nested, overrides: effectiveOverrides(nested, main) }
    : nested;
}
