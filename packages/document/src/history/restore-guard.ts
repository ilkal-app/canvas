import * as Y from 'yjs';

import type { UndoStep } from './field-guard.js';
import {
  editorsSince,
  isOthersSince,
  isObjectWrittenByOthers,
  isTypeWrittenByOthers,
  mapOf,
  REPAIR_KEYS,
  type WriterScope,
} from './written-by-others.js';

// Fix round 1. Yjs restores a value a step removed only when every later value of its
// key was removed by the step, by a step on a stack, or was re-created elsewhere (`item.redone`);
// anything else it takes for another client's change and refuses. The last pass is a hole: when
// the user deletes an object and undoes the delete, Yjs re-creates every value in it, another
// client's included, as the user's own copies, and marks the originals re-created. A later undo
// of an older step of that key then passes the other client's original and writes the older
// value over its copy: Ada recolours a shape, Bob recolours it, Ada deletes the shape and undoes
// the delete, and Ada's next undo put her old colour over Bob's. The history now leaves such a
// restore out of the step it hands Yjs, so Bob's value stays; a step left with nothing to do is
// used up, as any other. Found by `creation-guard.property.sync.test.ts`.
//
// The same test found the field-level twin of: a step sets a label (a map value) and
// another client types into it; undoing the step deleted the label and Ada's typing with it,
// then wrote the label's earlier value (none). A value the step set that holds a shared type
// another client has written inside since is kept (`keptValues`), and its key is not restored.

/**
 * Tells whether an item lies inside the objects map.
 *
 * @param item - The item.
 * @param objects - The document's objects map.
 * @returns `true` when one of its owners is the objects map.
 */
function isInside(item: Y.Item, objects: Y.Map<unknown>): boolean {
  let parent = item.parent;
  while (parent instanceof Y.AbstractType) {
    if (parent === objects) return true;
    const owner: Y.Item | null = parent._item;
    if (owner === null) return false;
    parent = owner.parent;
  }
  return false;
}

/**
 * The last re-creation of an item: where Yjs writes what it restores inside the item's type.
 *
 * @param item - The item.
 * @param store - The document's struct store.
 * @returns The item its re-creations end in (the item itself when it was not re-created).
 */
export function lastCopyOf(item: Y.Item, store: Y.Doc['store']): Y.Item {
  let last = item;
  while (last.redone !== null) {
    const next = Y.getItem(store, last.redone);
    if (!(next instanceof Y.Item)) return last;
    last = next;
  }
  return last;
}

/**
 * An item and every re-creation of it, oldest first (Yjs keeps the chain in `item.redone`).
 *
 * @param item - The item.
 * @param store - The document's struct store.
 * @returns The item, then its copies.
 */
function copiesOf(item: Y.Item, store: Y.Doc['store']): Y.Item[] {
  const copies = [item];
  for (let last = item; last.redone !== null;) {
    const next = Y.getItem(store, last.redone);
    if (!(next instanceof Y.Item)) break;
    copies.push(next);
    last = next;
  }
  return copies;
}

/**
 * Tells whether another person has written a value since the step, in any of its incarnations:
 * the value itself (a reference key only with a stamp by the same client,
 * `written-by-others.ts`), or, for a shared value, anything inside it (an object: any key,
 * text, label or network; a label: its text). Fix round 2 (N1): another person's writes can
 * survive only in an earlier incarnation, which an undone delete re-created as copies.
 *
 * @param value - A map value.
 * @param scope - The step's scope.
 * @param objects - The document's objects map.
 * @param editorsOf - The editors of an object's map since the step (`editorsSince`); a caller
 *   that asks about many values of one map passes a memo.
 * @returns `true` when another person wrote it, or inside it, since the step.
 */
function isValueWrittenByOthers(
  value: Y.Item,
  scope: WriterScope,
  objects: Y.Map<unknown>,
  editorsOf: (map: Y.AbstractType<unknown>) => ReadonlySet<number> = (map) =>
    editorsSince(map, scope),
): boolean {
  return copiesOf(value, scope.store).some((copy) => {
    const map = mapOf(copy);
    if (copy.parent === objects) {
      return (
        isOthersSince(copy, scope) || (map !== null && isObjectWrittenByOthers(map, scope, true))
      );
    }
    const parent = copy.parent as Y.AbstractType<unknown>;
    const isRepairKey = REPAIR_KEYS.has(copy.parentSub ?? '') && parent._item?.parent === objects;
    const writers = isRepairKey ? editorsOf(parent) : null;
    if (isOthersSince(copy, scope) && (writers?.has(copy.id.client) ?? true)) return true;
    return map !== null && isTypeWrittenByOthers(map, scope);
  });
}

/**
 * Tells whether a value's map was re-created and another person has written the value's key in
 * the live map since the step (fix round 2): Yjs writes a restore into the live map of an object
 * an undone delete re-created, but checks conflicts only along the key's values in the value's
 * own, earlier map; a value with no later value there is written over whatever the live map
 * holds (a network member another client added under the id since;
 * `creation-guard.recreated.sync.test.ts`). Cost: one pass over the live key's values, with the
 * map's editors read once.
 *
 * @param value - A value the step would restore.
 * @param scope - The step's scope.
 * @param objects - The document's objects map.
 * @returns `true` when the live key holds another person's write since the step.
 */
function isLiveKeyWrittenByOthers(
  value: Y.Item,
  scope: WriterScope,
  objects: Y.Map<unknown>,
): boolean {
  const owner = (value.parent as Y.AbstractType<unknown>)._item;
  if (owner === null) return false;
  const live = lastCopyOf(owner, scope.store);
  const map = mapOf(live);
  if (live === owner || map === null) return false;
  const editors = new Map<Y.AbstractType<unknown>, ReadonlySet<number>>();
  const editorsOf = (type: Y.AbstractType<unknown>): ReadonlySet<number> => {
    const known = editors.get(type) ?? editorsSince(type, scope);
    editors.set(type, known);
    return known;
  };
  for (let current = map._map.get(value.parentSub ?? '') ?? null; current !== null;) {
    if (isValueWrittenByOthers(current, scope, objects, editorsOf)) return true;
    current = current.left;
  }
  return false;
}

/**
 * Tells whether restoring a value would write it over another person's work where Yjs's
 * conflict rule lets it pass: walking right along the key's values as Yjs does, it passes a
 * re-created value another person wrote, or wrote inside, since the step (fix round 1; fix
 * round 2 reads inside and every incarnation, property seed 2088); or the value's map was
 * re-created and the live map's key holds another person's write ({@link
 * isLiveKeyWrittenByOthers}). Cost: one pass over the later values and the live key's values.
 *
 * @param value - A value the step removed and would restore.
 * @param step - The step.
 * @param scope - The step's scope.
 * @param isOwnDeletion - Whether a step on one of the history's stacks deleted an item.
 * @param objects - The document's objects map.
 * @returns `true` to leave the restore out.
 */
function passesOthersWork(
  value: Y.Item,
  step: UndoStep,
  scope: WriterScope,
  isOwnDeletion: (id: Y.ID) => boolean,
  objects: Y.Map<unknown>,
): boolean {
  if (isLiveKeyWrittenByOthers(value, scope, objects)) return true;
  let left = value;
  for (let right = left.right; right !== null; right = left.right) {
    if (right.redone !== null) {
      if (isValueWrittenByOthers(right, scope, objects)) return true;
      left = lastCopyOf(right, scope.store);
    } else if (Y.isDeleted(step.insertions, right.id) || isOwnDeletion(right.id)) {
      left = right;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * The shared values (labels) a step set that another client has written inside since the step:
 * undoing the step must keep them, and must not restore their keys' earlier values.
 *
 * @param transaction - The open transaction the step will be applied in.
 * @param step - The step.
 * @param objects - The document's objects map.
 * @param scope - The step's scope.
 * @returns The values to keep: current values of their keys, inside objects.
 */
export function keptValues(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
  scope: WriterScope,
): Set<Y.Item> {
  const kept = new Set<Y.Item>();
  Y.iterateDeletedStructs(transaction, step.insertions, (struct) => {
    if (!(struct instanceof Y.Item)) return;
    // Yjs deletes the last re-creation of what the step inserted (`item.redone`).
    const item = lastCopyOf(struct, scope.store);
    const parent = item.parent;
    if (item.deleted || item.parentSub === null || parent === objects) return;
    if (!(parent instanceof Y.AbstractType) || !isInside(item, objects)) return;
    if (parent._map.get(item.parentSub) !== item) return;
    if (!(item.content instanceof Y.ContentType)) return;
    // Another person's typing may survive only in an earlier incarnation (fix round 2, N1).
    const isTouched = copiesOf(struct, scope.store).some((copy) => {
      const map = mapOf(copy);
      return map !== null && isTypeWrittenByOthers(map, scope);
    });
    if (isTouched) kept.add(item);
  });
  return kept;
}

/**
 * Tells whether a value the step removed belongs to a key whose current value is kept: the
 * same key of the same map, or of the map an undo or redo re-created it as.
 *
 * @param value - The value the step would restore.
 * @param kept - The values kept.
 * @param store - The document's struct store.
 * @returns `true` when its key's current value is kept.
 */
function isKeyOfKeptValue(
  value: Y.Item,
  kept: ReadonlySet<Y.Item>,
  store: Y.Doc['store'],
): boolean {
  if (kept.size === 0 || !(value.parent instanceof Y.AbstractType)) return false;
  const owner = value.parent._item;
  const map = owner === null ? value.parent : mapOf(lastCopyOf(owner, store));
  const current = map?._map.get(value.parentSub ?? '');
  return current !== undefined && kept.has(current);
}

/**
 * The values a step removed that it must not restore (see above).
 *
 * @param transaction - The open transaction the step will be applied in.
 * @param step - The step.
 * @param objects - The document's objects map.
 * @param scope - The step's scope.
 * @param isOwnDeletion - Whether a step on one of the history's stacks deleted an item.
 * @param kept - The values the step keeps ({@link keptValues}).
 * @returns The values to leave out; empty for most steps.
 */
export function blockedRestores(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
  scope: WriterScope,
  isOwnDeletion: (id: Y.ID) => boolean,
  kept: ReadonlySet<Y.Item>,
): Y.Item[] {
  const blocked: Y.Item[] = [];
  Y.iterateDeletedStructs(transaction, step.deletions, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parentSub === null) return;
    if (Y.isDeleted(step.insertions, struct.id) || !isInside(struct, objects)) return;
    if (
      isKeyOfKeptValue(struct, kept, scope.store) ||
      passesOthersWork(struct, step, scope, isOwnDeletion, objects)
    ) {
      blocked.push(struct);
    }
  });
  return blocked;
}

/**
 * A copy of a step that does not restore some of the values it removed: its deletions without
 * those items. It shares the step's `meta` (its causal past).
 *
 * @param step - The step.
 * @param items - The values to leave out.
 * @returns The copy, or `step` itself when there is nothing to leave out.
 */
export function withoutRestores(step: UndoStep, items: readonly Y.Item[]): UndoStep {
  if (items.length === 0) return step;
  const deletions = Y.createDeleteSet();
  for (const [client, ranges] of step.deletions.clients) {
    let pieces = ranges.map(({ clock, len }) => ({ clock, len }));
    for (const { id, length } of items) {
      if (id.client !== client) continue;
      pieces = pieces.flatMap(({ clock, len }) => {
        const end = clock + len;
        if (id.clock + length <= clock || id.clock >= end) return [{ clock, len }];
        const before = { clock, len: id.clock - clock };
        const after = { clock: id.clock + length, len: end - id.clock - length };
        return [before, after].filter((piece) => piece.len > 0);
      });
    }
    if (pieces.length > 0) deletions.clients.set(client, pieces);
  }
  const copy = Object.create(Object.getPrototypeOf(step) as object) as UndoStep;
  return Object.assign(copy, step, { deletions });
}
