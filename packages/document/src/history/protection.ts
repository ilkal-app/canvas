import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { causalPastOf } from './causal-past.js';
import type { UndoStep } from './field-guard.js';
import {
  editorsSince,
  isOthersSince,
  REPAIR_KEYS,
  writerScopeOf,
  type WriterScope,
} from './written-by-others.js';

/**
 * Why the last undo or redo changed nothing (X2): the objects its step would have
 * changed that another person edited since, and the Yjs client ids they wrote with (those
 * that wrote the objects' `updatedAt`, as `editorsSince` counts them: never the product's own
 * repair, and this history's own ids only for another history's write lane on them).
 * The app names the person a client id belongs to, when presence can, and outlines the objects
 * in their colour.
 */
export interface UndoProtection {
  /** The objects another person edited since the step, sorted. */
  readonly objectIds: readonly ObjectId[];
  /** The other clients that edited them, sorted; at least one. */
  readonly writers: readonly number[];
}

/**
 * The object an item lies in: its entry in the objects map, walking up the item's owners.
 *
 * @param item - The item.
 * @param objects - The document's top-level objects map.
 * @returns The object's id (its key in the objects map), or `null` for an item outside the
 *   objects.
 */
function objectIdOf(item: Y.Item, objects: Y.Map<unknown>): string | null {
  let entry = item;
  while (entry.parent !== objects) {
    const owner = (entry.parent as Y.AbstractType<unknown> | null)?._item ?? null;
    if (owner === null) return null;
    entry = owner;
  }
  return entry.parentSub;
}

/**
 * Finds authors of content writes when a command's timestamp equals the previous value.
 * Reference-only system repairs are excluded just as in the creation guard.
 *
 * @param map - The protected object's content.
 * @param scope - The history step's causal past.
 * @returns Authors of actual content edits.
 */
function contentEditors(map: Y.AbstractType<unknown>, scope: WriterScope): Set<number> {
  const result = editorsSince(map, scope);
  const visit = (item: Y.Item): void => {
    if (isOthersSince(item, scope)) result.add(item.id.client);
    if (item.content instanceof Y.ContentType) {
      for (const writer of contentEditors(item.content.type, scope)) result.add(writer);
    }
  };
  for (const [key, current] of map._map) {
    if (REPAIR_KEYS.has(key)) continue;
    for (let item: Y.Item | null = current; item !== null; item = item.left) visit(item);
  }
  for (let item = map._start; item !== null; item = item.right) visit(item);
  return result;
}

/**
 * Why a step that changed nothing was used up: of the objects its insertions and
 * deletions lie in that are on the board, those another client edited since the step (its
 * causal past), with those clients. Call inside the undo or redo transaction that used it up,
 * while its structs are still in the store. Cost: one pass over the step's structs, then over
 * each object's `updatedAt` values.
 *
 * @param transaction - The open transaction.
 * @param step - The step used up.
 * @param objects - The document's top-level objects map.
 * @param dependents - Additional children that protected a container identity change.
 * @returns The protection, or `undefined` when no other client edited what it would change (it
 *   was used up for another reason, or recorded without a causal past).
 */
export function protectionOf(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
  dependents: Iterable<ObjectId> = [],
): UndoProtection | undefined {
  const past = causalPastOf(step);
  if (past === undefined) return undefined;
  const { doc } = transaction;
  const scope = writerScopeOf(past, doc);
  const protectedDependents = new Set<string>(dependents);
  const ids = new Set<string>(protectedDependents);
  const collect = (struct: Y.AbstractStruct): void => {
    if (!(struct instanceof Y.Item)) return;
    const id = objectIdOf(struct, objects);
    if (id !== null) ids.add(id);
  };
  Y.iterateDeletedStructs(transaction, step.insertions, collect);
  Y.iterateDeletedStructs(transaction, step.deletions, collect);
  const objectIds: string[] = [];
  const writers = new Set<number>();
  for (const id of ids) {
    const map = objects.get(id);
    if (!(map instanceof Y.AbstractType)) continue;
    const editors = protectedDependents.has(id)
      ? contentEditors(map, scope)
      : editorsSince(map, scope);
    if (editors.size === 0) continue;
    objectIds.push(id);
    for (const editor of editors) writers.add(editor);
  }
  if (writers.size === 0) return undefined;
  return {
    objectIds: objectIds.sort() as ObjectId[],
    writers: [...writers].sort((first, second) => first - second),
  };
}

/**
 * Two protections as one: the objects and the writers of both (a step written in parts is
 * undone part by part). Pure.
 *
 * @param first - One, if any.
 * @param second - The other, if any.
 * @returns Both, or whichever there is.
 */
export function mergeProtections(
  first: UndoProtection | undefined,
  second: UndoProtection | undefined,
): UndoProtection | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return {
    objectIds: [...new Set([...first.objectIds, ...second.objectIds])].sort(),
    writers: [...new Set([...first.writers, ...second.writers])].sort((one, other) => one - other),
  };
}
