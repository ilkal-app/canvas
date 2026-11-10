import * as Y from 'yjs';

import type { CausalPast } from './causal-past.js';
import type { OperatedWrites } from './operated-writes.js';
import { keyedLanesOf, type WriteLanes } from './write-lanes.js';

// Whether another person has written somewhere since a step, by the rule the field
// guard uses for one key (`field-guard.ts`, `isWrittenByOthersSince`): an item another client
// wrote that the step's causal past does not cover. Deleted items count (a write since, even if
// a later write, a merge or a delete removed it); a delete leaves no item and counts for nothing,
// but every command stamps `updatedAt` on every object it writes, which is a write.
//
// The product's own writes never count. The reference repair runs on every client that sees a
// dangling reference, so a peer's repair of a key is nobody's edit; it writes only the reference
// keys (`REPAIR_KEYS`) and never `updatedAt`, while every command stamps `updatedAt`
// (`creation-guard.writers.test.ts` pins both). So a peer's write of a reference key counts only
// when the same peer also wrote that object's `updatedAt` since the step: the peer's person
// made it.
//
// Histories on one store share its client ids, so among the store's own writes those of
// another history's write lane (`write-lanes.ts`: callers sharing one agent connection,
// each with its own history key) count as another writer's too, exactly as another client's.
// The other way round, another client id's writes that the history recorded as its user's (an
// agent the user operates writing from another process, `operated-writes.ts`) count as
// own, as the store's own are.

/** What decides, for one step, whose writes count as another client's. */
export interface WriterScope {
  /** The step's causal past; its `historyKey` is the step's write lane. */
  readonly past: CausalPast;
  /** This history's own Yjs client ids: the step's, and the document's now. */
  readonly ownIds: ReadonlySet<number>;
  /** The document's struct store, to follow re-creations. */
  readonly store: Y.Doc['store'];
  /**
   * The document's write lanes, when a keyed history was made on it: an item of an own client
   * id in another lane than the step's is another writer's. Absent, every own item is own.
   */
  readonly lanes?: WriteLanes;
  /**
   * The other client ids' writes the step's history recorded as its user's: an item
   * wholly inside them is own. Absent, every item of another client id is another writer's.
   */
  readonly operated?: OperatedWrites;
}

/**
 * The scope of a step of a history on a document: its causal past, the step's and the
 * document's client ids as its own, and the document's write lanes.
 *
 * @param past - The step's causal past.
 * @param doc - The document.
 * @returns The scope.
 */
export function writerScopeOf(past: CausalPast, doc: Y.Doc): WriterScope {
  const lanes = keyedLanesOf(doc);
  return {
    past,
    ownIds: new Set([past.clientId, doc.clientID]),
    store: doc.store,
    ...(lanes === undefined ? {} : { lanes }),
    ...(past.operated === undefined ? {} : { operated: past.operated }),
  };
}

/**
 * The keys of an object the reference repair writes (`repair/reference-repair.ts`): a re-rooted
 * child's `placement` and `z`, a detached connector end's `from` or `to`, a re-pinned comment's
 * `anchor`.
 */
export const REPAIR_KEYS: ReadonlySet<string> = new Set(['placement', 'z', 'from', 'to', 'anchor']);

/**
 * Tells whether another writer wrote an item after the step's causal past: another client (but
 * for the writes the history recorded as its user's), or, on an own client id, another
 * history's write lane (in the part of the item after the past).
 *
 * @param item - The item.
 * @param scope - The step's scope.
 * @returns `true` for another writer's write the step did not have in view.
 */
export function isOthersSince(item: Y.Item, scope: WriterScope): boolean {
  const { client, clock } = item.id;
  const end = clock + item.length;
  const seen = scope.past.state.get(client) ?? 0;
  if (end <= seen) return false;
  if (!scope.ownIds.has(client)) {
    return scope.operated?.covers(client, Math.max(clock, seen), end) !== true;
  }
  return (
    scope.lanes?.hasOtherLane(client, Math.max(clock, seen), end, scope.past.historyKey) === true
  );
}

/**
 * Tells whether another client wrote a map key since the step: some value of the key (the
 * current one or an earlier one, which Yjs keeps in the key's chain) is another client's write
 * outside the step's past. Cost: one pass over the key's values.
 *
 * @param current - The key's current value.
 * @param scope - The step's scope.
 * @param writers - When given, only writes by these clients count.
 * @returns `true` when another client wrote the key since the step.
 */
export function isKeyWrittenByOthers(
  current: Y.Item,
  scope: WriterScope,
  writers?: ReadonlySet<number>,
): boolean {
  for (let value: Y.Item | null = current; value !== null; value = value.left) {
    if (isOthersSince(value, scope) && (writers?.has(value.id.client) ?? true)) return true;
  }
  return false;
}

/**
 * The other clients whose people edited an object since the step: those that wrote its
 * `updatedAt`.
 *
 * @param map - The object's map.
 * @param scope - The step's scope.
 * @returns Their client ids.
 */
export function editorsSince(map: Y.AbstractType<unknown>, scope: WriterScope): Set<number> {
  const editors = new Set<number>();
  for (let value = map._map.get('updatedAt') ?? null; value !== null; value = value.left) {
    if (isOthersSince(value, scope)) editors.add(value.id.client);
  }
  return editors;
}

/**
 * Tells whether another client wrote anywhere inside a shared type since the step: any key of a
 * map, any item of a text, and, recursively, inside the shared types they hold or held (a
 * label, a text, a network). Cost: one pass over the type's items, deleted ones included.
 *
 * @param type - The type.
 * @param scope - The step's scope.
 * @returns `true` when another client wrote inside it since the step.
 */
export function isTypeWrittenByOthers(type: Y.AbstractType<unknown>, scope: WriterScope): boolean {
  const values: Y.Item[] = [...type._map.values()];
  for (const current of values) if (isKeyWrittenByOthers(current, scope)) return true;
  for (let item = type._start; item !== null; item = item.right) {
    if (isOthersSince(item, scope)) return true;
    values.push(item);
  }
  // Deleted values too: an earlier incarnation, which an undone delete re-created, is all
  // deleted, and another person's writes may survive only there (fix round 2, N1).
  return values.some(
    (value) =>
      value.content instanceof Y.ContentType &&
      isTypeWrittenByOthers(value.content.type as Y.AbstractType<unknown>, scope),
  );
}

/**
 * Tells whether another person wrote to an object since the step: its `updatedAt`, any key
 * but the reference keys, and a reference key only with its `updatedAt` (see above). Deep, the
 * object's texts, label and network too; else only its own keys, which suffices where every
 * write inside comes with a stamp. Cost: one pass over the keys' values, and when deep over
 * the object's items.
 *
 * @param map - The object's map, live or an earlier incarnation of it.
 * @param scope - The step's scope.
 * @param isDeep - Whether to look inside its shared values.
 * @returns `true` when another person wrote to it since the step.
 */
export function isObjectWrittenByOthers(
  map: Y.AbstractType<unknown>,
  scope: WriterScope,
  isDeep: boolean,
): boolean {
  const editors = editorsSince(map, scope);
  if (editors.size > 0) return true;
  for (const [key, current] of map._map) {
    if (isKeyWrittenByOthers(current, scope, REPAIR_KEYS.has(key) ? editors : undefined)) {
      return true;
    }
    const value = current.content;
    if (isDeep && value instanceof Y.ContentType) {
      if (isTypeWrittenByOthers(value.type as Y.AbstractType<unknown>, scope)) return true;
    }
  }
  return false;
}

/**
 * Every incarnation of an object: its live entry and the earlier entries under its id that
 * undo or redo re-created as it (`item.redone`), newest first. Yjs re-creates a deleted object's
 * map and every value in it as new items of the client that undid the delete, so another
 * client's writes stay only in the earlier incarnations, which the undo manager keeps alive.
 * Cost: one pass over the id's entries, following each one's re-creations.
 *
 * @param live - The object's live entry in the objects map.
 * @param store - The document's struct store.
 * @returns The entries whose re-creations end in `live`, `live` first.
 */
export function incarnationsOf(live: Y.Item, store: Y.Doc['store']): Y.Item[] {
  const incarnations = [live];
  for (let entry = live.left; entry !== null; entry = entry.left) {
    let last: Y.Item = entry;
    while (last.redone !== null) {
      const next = Y.getItem(store, last.redone);
      if (!(next instanceof Y.Item)) break;
      last = next;
    }
    if (last === live) incarnations.push(entry);
  }
  return incarnations;
}

/**
 * The shared map an object entry holds.
 *
 * @param entry - An entry of the objects map.
 * @returns The map, or `null` for a plain value.
 */
export function mapOf(entry: Y.Item): Y.AbstractType<unknown> | null {
  return entry.content instanceof Y.ContentType
    ? (entry.content.type as Y.AbstractType<unknown>)
    : null;
}
