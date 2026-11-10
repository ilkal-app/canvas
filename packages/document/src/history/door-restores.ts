import * as Y from 'yjs';

import { drawableValuesReason, type ObjectId, type StoredValueReader } from '@canvas/schema';

import { readStoredMember } from '../codec/network-codec.js';
import type { ObjectFieldLanding } from '../meta/field-landings.js';
import { judgedKindOf } from '../meta/field-values.js';

import type { UndoStep } from './field-guard.js';
import { mapOf } from './written-by-others.js';

// What an undo or redo would write back, read before Yjs applies it, and the relay's
// door judgement of each value (part 1). Yjs restores a value a step removed by
// integrating a copy of its item (`redoItem`): the same content, under the same key, in the
// object's live map, or in the map of an object the step re-creates. The door judges such a copy
// as any value an update writes: by the key it lands under (`judgedKindOf`, the door's own
// table), with the schema's predicate (`drawableValuesReason`), letting through a field equal to
// what the board holds at that place now, but in a size, which is judged whole (as
// commands judge one). A re-created object has nothing stored under its id, so each of its values
// is judged whole. Package-internal.

/** A value a step would write back, and where it lands. */
export interface Restore {
  /** The removed item Yjs would copy. */
  readonly item: Y.Item;
  /** The entry, in the objects map, of the object map the item was written in. */
  readonly entry: Y.Item;
  /** Where it lands, as the door names it. */
  readonly field: ObjectFieldLanding;
}

/** The restores of one step. */
export interface StepRestores {
  /** The objects the step would re-create, each with its removed entry. */
  readonly recreated: ReadonlyMap<ObjectId, Y.Item>;
  /** The values it would write inside objects, re-created ones included. */
  readonly values: readonly Restore[];
}

/** The keys of an object's map that hold a reference to another object. */
const REFERENCE_KEYS: ReadonlySet<string> = new Set(['placement', 'from', 'to', 'anchor']);

/**
 * Tells whether a value is a plain record.
 *
 * @param value - Anything.
 * @returns `true` for a record that is not an array.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Where a removed map entry lands: an object's own key (its map one level under `objects`), or a
 * member of one of its networks (two levels under), as the door's `FieldLandings` resolves an
 * incoming value. Deeper values (a label's contents, text) are in no field the door judges.
 *
 * @param item - A removed map entry.
 * @param objects - The document's objects map.
 * @returns Its object's entry and its landing, or `undefined` outside an object's fields.
 */
function landingOf(
  item: Y.Item,
  objects: Y.Map<unknown>,
): { readonly entry: Y.Item; readonly field: ObjectFieldLanding } | undefined {
  const key = item.parentSub;
  const parent = item.parent;
  if (key === null || !(parent instanceof Y.AbstractType)) return undefined;
  const owner = parent._item;
  if (owner?.parentSub === undefined || owner.parentSub === null) return undefined;
  if (owner.parent === objects) return { entry: owner, field: { objectId: owner.parentSub, key } };
  const network = owner.parent;
  if (!(network instanceof Y.AbstractType)) return undefined;
  const entry = network._item;
  if (entry?.parent !== objects || entry.parentSub === null) return undefined;
  return { entry, field: { objectId: entry.parentSub, key: owner.parentSub, memberId: key } };
}

/**
 * Sorts out what a step would write back: the objects it re-creates (removed entries of the
 * objects map that were never re-created; Yjs re-creates a copied one only through its copy) and
 * every value it restores inside an object. Cost: one pass over the step's removed structs.
 *
 * @param transaction - The open transaction the step will be applied in.
 * @param step - The step, as it will be handed to Yjs.
 * @param objects - The document's objects map.
 * @returns The restores.
 */
export function restoresOf(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
): StepRestores {
  const recreated = new Map<ObjectId, Y.Item>();
  const values: Restore[] = [];
  Y.iterateDeletedStructs(transaction, step.deletions, (struct) => {
    // Yjs never restores what the step itself inserted.
    if (!(struct instanceof Y.Item) || Y.isDeleted(step.insertions, struct.id)) return;
    if (struct.parent === objects) {
      if (struct.parentSub !== null && struct.redone === null) {
        recreated.set(struct.parentSub as ObjectId, struct);
      }
      return;
    }
    const landing = landingOf(struct, objects);
    if (landing !== undefined) values.push({ item: struct, ...landing });
  });
  return { recreated, values };
}

/**
 * The value a removed item holds, as `Y.Map#get` reads its copy.
 *
 * @param item - The item.
 * @returns `{ value }` for plain content (`any`, JSON, an embed), or `undefined` for any other
 *   content, which the door refuses under a judged key.
 */
function plainValueOf(item: Y.Item): { readonly value: unknown } | undefined {
  const { content } = item;
  const isPlain =
    content instanceof Y.ContentAny ||
    content instanceof Y.ContentJSON ||
    content instanceof Y.ContentEmbed;
  return isPlain ? { value: content.getContent().at(-1) } : undefined;
}

/**
 * Reads what the board holds where a value lands, as the door reads the hub: the object's key,
 * or a network member unwrapped from its stored `[order, member]`.
 *
 * @param objects - The document's objects map, before the step.
 * @param field - Where the value lands.
 * @returns The reader.
 */
function storedReaderOf(objects: Y.Map<unknown>, field: ObjectFieldLanding): StoredValueReader {
  return () => {
    const object = objects.get(field.objectId);
    if (!(object instanceof Y.Map) || !object.has(field.key)) return undefined;
    const value: unknown = object.get(field.key);
    if (field.memberId === undefined) return { value };
    if (!(value instanceof Y.Map) || !value.has(field.memberId)) return undefined;
    const member = readStoredMember(value.get(field.memberId));
    return member === undefined ? undefined : { value: member[1] };
  };
}

/**
 * Tells whether the relay's door would refuse the copy of a value a step restores (
 * part 1): the key is one the door judges, and the value is not plain content, or the schema's
 * predicate refuses a field of it that differs from what the board holds there now. Reads the
 * board only for a value it would refuse. Pure; O(the value's fields).
 *
 * @param restore - The restore.
 * @param objects - The document's objects map, before the step.
 * @returns `true` when the door would refuse it.
 */
export function isRefusedAtDoor(restore: Restore, objects: Y.Map<unknown>): boolean {
  const kind = judgedKindOf(restore.field);
  if (kind === undefined) return false;
  const read = plainValueOf(restore.item);
  if (read === undefined) return true;
  const value =
    restore.field.memberId === undefined ? read.value : readStoredMember(read.value)?.[1];
  // A size is judged whole, never let through as the board holds it, as commands judge
  // one (`store/door-values.ts`): the hub may hold another by the time the restore arrives.
  const stored = kind === 'size' ? undefined : storedReaderOf(objects, restore.field);
  return drawableValuesReason(kind, value, stored) !== undefined;
}

/**
 * The object a restored value refers to: a child's parent (`placement.parentId`), the object
 * a connector end or a comment pin is attached to.
 *
 * @param restore - A restore.
 * @returns The referred object's id, or `undefined` when the value refers to none.
 */
export function referenceOf(restore: Restore): ObjectId | undefined {
  const { key, memberId } = restore.field;
  if (memberId !== undefined || !REFERENCE_KEYS.has(key)) return undefined;
  const value = plainValueOf(restore.item)?.value;
  if (!isRecord(value)) return undefined;
  const id = key === 'placement' ? value.parentId : value.kind === 'object' && value.objectId;
  return typeof id === 'string' ? (id as ObjectId) : undefined;
}

/**
 * The value a key holds now in an object's live map: what keeping the key as it is keeps.
 *
 * @param live - The object's live entry.
 * @param field - The key, or the network member.
 * @returns The key's current item, or `undefined` when it holds none.
 */
export function currentValueOf(live: Y.Item, field: ObjectFieldLanding): Y.Item | undefined {
  const own = mapOf(live)?._map.get(field.key);
  if (field.memberId === undefined || own === undefined) return own;
  return mapOf(own)?._map.get(field.memberId);
}
