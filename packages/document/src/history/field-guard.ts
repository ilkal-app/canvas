import * as Y from 'yjs';

import { causalPastOf, type CausalPast } from './causal-past.js';
import { isKeyReplacedBy, type KeyReplacements } from './key-replacements.js';
import { isKeyWrittenByOthers, writerScopeOf } from './written-by-others.js';

// Undo must never leave an object field without a value: every field (or group of fields) of an
// object, and of a label inside it, is always present in its `Y.Map`, and an object missing one
// cannot be read (a `missing-field` issue; the object drops out of the snapshot). A member of a
// vector network is a key of the network's `Y.Map` and is guarded the same way once edited.
//
// `Y.UndoManager` can leave a field empty after concurrent edits, because it will not overwrite
// "a change from another client" and treats any later value of the key as one, even a value the
// merge has already discarded (undo reverts only the user's own changes):
//
// 1. The user's write to a field won a concurrent write by another client (the loser is deleted
//    on merge). Undo deletes the user's value, then refuses to restore the value before it,
//    because the discarded write sits after it. `isCurrentFieldValue` makes undo keep the
//    user's value instead: it was the value both clients agreed on, and the other one is gone.
// 2. The user deleted an object while another client edited a field of it (the edit lands in
//    the deleted map and is discarded). Undoing the delete re-creates the object's map but
//    refuses to restore that field, for the same reason, although the new map has no value to
//    overwrite. `restoreEmptiedFields` restores the field's value from before the delete (for a
//    label another client replaced meanwhile, `null`).
// 3. Case 1 for a field whose value is a shared type (a label): two clients set a label at once,
//    and the user's won. Undo keeps the label map (case 1) but deleted the text and runs the
//    same step put inside it, so the label, and the object, could no longer be read (
//    the fuzz then found a comment pinned to an object missing from every board).
//    `isInsideKeptValue` keeps a kept value's contents whole, also when an earlier undo or
//    redo re-created them (Yjs then asks about the re-created items).
// 4. Case 1 must not keep a value nobody else wanted. A key removed and written again
//    (a vector network member whose addition was undone and redone, or whose deletion was
//    undone) has earlier values in its history, all of them this user's or in view when the
//    step was made: undo or redo that removes it returns the key to what the step found or
//    left. `isGuardedFieldValue` keeps a current value only when another client wrote the key
//    concurrently with the step being undone or redone, or since (judged by the state vector
//    each step records before its first transaction, `causal-past.ts`), or the step replaced
//    the key's value (case 1).

/** A step of a `Y.UndoManager`: what it inserted and what it deleted. */
export type UndoStep = NonNullable<ReturnType<Y.UndoManager['undo']>>;

/**
 * Tells whether an item holds the current value of a field inside an object: a map entry of a
 * nested map (not an entry of the top-level objects map, which undo must be able to delete to
 * undo a creation) that has earlier values of its key before it and is still the key's value.
 * A key's first value (`item.left === null`) is never one: deleting it reverts the key's
 * creation, not a change of its value. {@link isGuardedFieldValue} narrows this to the values
 * undo must keep.
 *
 * @param item - An item undo or redo is about to delete.
 * @param objects - The document's top-level objects map.
 * @returns `true` when the item is its key's value and has earlier values before it.
 */
export function isCurrentFieldValue(item: Y.Item, objects: Y.Map<unknown>): boolean {
  const key = item.parentSub;
  const parent = item.parent;
  if (key === null || parent === objects || !(parent instanceof Y.AbstractType)) return false;
  return item.left !== null && parent._map.get(key) === item;
}

/**
 * Tells whether another client wrote a map entry's key concurrently with a step, or after it:
 * some value of the key (the entry or an earlier one; Yjs keeps deleted values in the key's
 * chain) was written by a client other than the step's and is not covered by the step's causal
 * past. Where Yjs placed that write, and whether the merge or a later write discarded it, does
 * not matter: the step's user did not have it in view. A write the step had in view protects
 * nothing: the user acted on it. A delete is not a write (it leaves no item) and protects
 * nothing either. On the step's own client ids, a write in another history's write lane
 * counts as another client's (`written-by-others.ts`, `isOthersSince`, the rule every
 * undo guard shares). Cost: one pass over the key's values.
 *
 * @param entry - The key's current value.
 * @param past - The step's causal past.
 * @returns `true` when another client wrote the key concurrently with the step or since.
 */
function isWrittenByOthersSince(entry: Y.Item, past: CausalPast): boolean {
  // An item undo or redo deletes is integrated, so its parent is in a document; were it not,
  // keeping the value is the safe answer.
  const { doc } = entry.parent as Y.AbstractType<unknown>;
  if (doc === null) return true;
  return isKeyWrittenByOthers(entry, writerScopeOf(past, doc));
}

/**
 * Tells whether undo or redo must keep an item it is about to delete, because deleting it
 * would leave its field without a value that someone wanted (cases 1 and 4 above): the item is
 * its field's current value (`isCurrentFieldValue`), and either another client wrote the key
 * concurrently with the step being undone or redone or since (`isWrittenByOthersSince`), or
 * the step replaced the key's value (it deleted an earlier value; deleting the item is then
 * right only when restoring that value succeeded, and then the item is no longer current).
 * Otherwise the key's values are all this user's or were in view when the step was made, and
 * deleting the current one returns the key to what the step found or left: no value (its first
 * value, or one written after an earlier value was deleted, as undo and redo re-create a
 * removed network member). In the grouped layout only a network map gains and loses
 * keys after an object is created (each vertex or segment is a key); an object's own keys are
 * all written when it is created, and are removed only with it.
 *
 * @param item - An item undo or redo is about to delete.
 * @param objects - The document's top-level objects map.
 * @param step - The step being undone or redone, or `undefined` outside an undo or redo (then
 *   every current value is kept, as it is for a step without a recorded causal past).
 * @param replacements - The current apply call's memo, absent outside its filter phase.
 * @returns `true` when undo must keep the item.
 */
export function isGuardedFieldValue(
  item: Y.Item,
  objects: Y.Map<unknown>,
  step: UndoStep | undefined,
  replacements?: KeyReplacements,
): boolean {
  if (!isCurrentFieldValue(item, objects)) return false;
  const past = step === undefined ? undefined : causalPastOf(step);
  if (step === undefined || past === undefined) return true;
  return (
    (replacements?.has(item, step) ?? isKeyReplacedBy(item, step)) ||
    isWrittenByOthersSince(item, past)
  );
}

/**
 * Tells whether an item lies inside a field value that {@link isGuardedFieldValue} keeps
 * against the step being undone or redone (case 3 above): a label map kept as its field's value
 * must keep the text and runs it holds, or it cannot be read. The value is kept against that
 * step when the step replaced its key: the step then set the value (or, if the value was since
 * re-created by another undo or redo, the value it copies), and undo keeps it whole. A value
 * whose key the step did not replace (a later edit of a label's text) is not protected: undo
 * reverts that edit. The decision reads only the owners and the step, never which step inserted
 * the item: Yjs follows `item.redone`, so an item it asks about may have been re-created by a
 * step on the other stack. Yjs deletes children before parents, so the kept value is still in
 * place when its contents are asked about.
 *
 * @param item - An item undo or redo is about to delete.
 * @param objects - The document's top-level objects map.
 * @param step - The step being undone or redone, or `undefined` outside an undo or redo.
 * @param replacements - The current apply call's memo, absent outside its filter phase.
 * @returns `true` when deleting the item would hollow out a value undo keeps.
 */
export function isInsideKeptValue(
  item: Y.Item,
  objects: Y.Map<unknown>,
  step: UndoStep | undefined,
  replacements?: KeyReplacements,
): boolean {
  if (step === undefined) return false;
  let parent = item.parent;
  while (parent instanceof Y.AbstractType && parent !== objects) {
    const owner: Y.Item | null = parent._item;
    // The object's own entry (in the objects map) ends the walk: undo may delete an object.
    if (owner === null || owner.parent === objects) break;
    if (
      isCurrentFieldValue(owner, objects) &&
      (replacements?.has(owner, step) ?? isKeyReplacedBy(owner, step))
    )
      return true;
    parent = owner.parent;
  }
  return false;
}

/**
 * Finds the live map a deleted item's parent map was re-created as by undo or redo.
 *
 * @param item - A deleted map entry.
 * @param store - The document's struct store.
 * @returns The re-created map, or `null` when the parent is a root type, was not deleted, or
 *   was not re-created.
 */
function recreatedParentOf(item: Y.Item, store: Y.Doc['store']): Y.Map<unknown> | null {
  const parent = item.parent;
  if (!(parent instanceof Y.AbstractType)) return null;
  let parentItem = parent._item;
  if (parentItem?.deleted !== true) return null;
  while (parentItem.redone !== null) parentItem = Y.getItem(store, parentItem.redone);
  if (parentItem.deleted || !(parentItem.content instanceof Y.ContentType)) return null;
  const recreated = parentItem.content.type;
  return recreated instanceof Y.Map ? (recreated as Y.Map<unknown>) : null;
}

/**
 * The value to restore a field to: a plain value as it was, whatever content held it, and `null`
 * for a field that held a shared type. A plain value is what `Y.Map#get` returns: `ContentAny`,
 * and JSON or an embed, which a peer's own encoder can write (a placement written as
 * JSON came back `null`, which no reader can read and the relay's door refuses, closing the
 * undoing client for good); the door reads them the same way (`door-restores.ts`). Only a label
 * is ever replaced by another client (text and networks are edited in place), and a deleted
 * label cannot be rebuilt: its characters are deleted items Yjs keeps only as undo metadata.
 * `null` is a valid label and is what a concurrent removal asked for.
 *
 * @param item - The deleted map entry.
 * @returns The value to write.
 */
function restoredValueOf(item: Y.Item): unknown {
  const { content } = item;
  const isPlain =
    content instanceof Y.ContentAny ||
    content instanceof Y.ContentJSON ||
    content instanceof Y.ContentEmbed;
  return isPlain ? content.getContent().at(-1) : null;
}

/**
 * Gives every field of a map that undo or redo re-created in this transaction a value when
 * restoring it was refused (case 2 above): the value it had when the step removed it, or `null`
 * for a label (see `restoredValueOf`). Run inside the undo or redo transaction, after the step
 * was applied, so the writes belong to it.
 *
 * @param transaction - The undo or redo transaction.
 * @param step - The step just applied; its deletions are what it restores.
 */
export function restoreEmptiedFields(transaction: Y.Transaction, step: UndoStep): void {
  const restores: [Y.Map<unknown>, string, unknown][] = [];
  Y.iterateDeletedStructs(transaction, step.deletions, (struct) => {
    // A value the step itself wrote and replaced is not what it restores.
    if (!(struct instanceof Y.Item) || struct.parentSub === null) return;
    if (Y.isDeleted(step.insertions, struct.id)) return;
    const recreated = recreatedParentOf(struct, transaction.doc.store);
    if (recreated === null || recreated.has(struct.parentSub)) return;
    restores.push([recreated, struct.parentSub, restoredValueOf(struct)]);
  });
  // Written after the walk, which must not see structs created while it runs.
  for (const [map, key, value] of restores) map.set(key, value);
}
