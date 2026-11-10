import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

/** The object-map keys one transaction created, updated and deleted. */
export interface ChangedKeys {
  /** Keys added to the object map. */
  readonly created: ReadonlySet<string>;
  /** Keys whose entry changed or was replaced, excluding created and deleted keys. */
  readonly updated: ReadonlySet<string>;
  /** Keys removed from the object map. */
  readonly deleted: ReadonlySet<string>;
}

/**
 * Finds the object-map key an edited shared type belongs to, walking up from a nested type (a
 * `Y.Text`, a label map, a vertex map) to the object's own map.
 *
 * @param type - The type an event fired on.
 * @param objects - The document's object map.
 * @returns The object's key, or `null` when the type is not under the object map.
 */
export function topLevelKeyOf(
  type: Y.AbstractType<unknown>,
  objects: Y.Map<unknown>,
): string | null {
  let current = type;
  while (current._item !== null) {
    const { parent, parentSub } = current._item;
    if (parent === objects) return parentSub;
    if (!(parent instanceof Y.AbstractType)) return null;
    current = parent as Y.AbstractType<unknown>;
  }
  return null;
}

/**
 * Collects which objects one transaction changed from the object map's deep events: key
 * changes on the map itself are creations, replacements and deletions; an event on any nested
 * type is an update of the object it sits in. An entry created and deleted within one
 * transaction does not appear.
 *
 * @param events - The events `observeDeep` delivered for one transaction.
 * @param objects - The document's object map.
 * @returns The changed keys, each in exactly one set.
 */
export function collectChangedKeys(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
  objects: Y.Map<unknown>,
): ChangedKeys {
  const created = new Set<string>();
  const updated = new Set<string>();
  const deleted = new Set<string>();
  for (const event of events) {
    if (event.target === objects) {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'add') created.add(key);
        else if (change.action === 'delete') deleted.add(key);
        else updated.add(key);
      }
      continue;
    }
    const key = topLevelKeyOf(event.target, objects);
    if (key !== null) updated.add(key);
  }
  for (const key of updated) {
    if (created.has(key) || deleted.has(key)) updated.delete(key);
  }
  return { created, updated, deleted };
}

/**
 * Sorts ids by UTF-16 code units, for deterministic change sets.
 *
 * @param keys - The keys.
 * @returns A new sorted array.
 */
export function sortedIds(keys: ReadonlySet<string>): ObjectId[] {
  return ([...keys] as ObjectId[]).sort();
}
