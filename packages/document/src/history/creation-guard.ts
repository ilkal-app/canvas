import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';

import { causalPastOf } from './causal-past.js';
import type { UndoStep } from './field-guard.js';
import { protectionOf, type UndoProtection } from './protection.js';
import { removedEntries } from './removed-entries.js';
import { blockedRestores, keptValues, withoutRestores } from './restore-guard.js';
import {
  editorsSince,
  incarnationsOf,
  isKeyWrittenByOthers,
  isObjectWrittenByOthers,
  isOthersSince,
  mapOf,
  writerScopeOf,
  type WriterScope,
} from './written-by-others.js';

// (protect). Undoing a creation deletes the object's map, and
// every later write inside it goes with it; the field guard protects values, not objects. So an
// undo or redo does not remove an object that another person has, since the step, written to
// (any key, its text, its label, its network), written to a child of (any write to an object
// directly inside it, fix round 1), or made another object refer to (attached a connector end
// to it, pinned a comment on it). Nobody's work is lost to someone else's undo. Per object: a
// step that creates several removes those nobody else touched. An object kept keeps what the
// same step created that it lies in (its parent, up) and inside it (a group's members, a
// frame's content), so nothing kept is left dangling or empty. When keeping an object would
// split the step (the step also moved existing objects into it, as `group` does, and undoing
// that would empty it), the whole step is used up unapplied. A step that changes nothing is
// used up as any other (`single-step.ts`), and the app says so.
// Another person's writes are found in every incarnation of an object (fix round 1, C1): after
// a delete and its undo, Yjs has re-created the object and every value in it as the undoing
// client's own items, and the other client's writes stay in the earlier incarnation, which the
// undo manager keeps alive. "Another person" is the field guard's notion, a Yjs client id other
// than this history's or another history's write lane on it (`write-lanes.ts`), so the
// same person in another tab or another keyed caller counts, a write the step had in view
// does not, and the product's own writes never count (`written-by-others.ts`). The step handed
// to Yjs also leaves out any restore that would write over a copy of another person's value
// (`restore-guard.ts`).

/**
 * The keys of a dependent that hold its reference to an object: a child's `placement` (its
 * `parentId`), a connector's attached ends, a comment's `anchor`.
 */
type ReferenceKey = 'placement' | 'from' | 'to' | 'anchor' | 'identity';

/**
 * Remembers, while one undo or redo runs, the objects it must not remove (see above), for the
 * history's delete filter. Reads the board before the step (the store has not seen it yet).
 * Single-threaded.
 */
export class CreationGuard {
  readonly #objects: Y.Map<unknown>;
  readonly #board: BoardReader;
  /** The entries of the objects kept, for the step being applied. */
  #kept = new Set<Y.Item>();
  /** The values (labels) others wrote inside that the step keeps (`restore-guard.ts`). */
  #keptValues = new Set<Y.Item>();
  /**
   * The objects kept by the parts of a grouped step applied so far, while one is
   * undone or redone; `undefined` outside a group.
   */
  #groupKept: Set<ObjectId> | undefined;
  #protectedChildren = new Set<ObjectId>();
  #groupSteps: readonly UndoStep[] | undefined;

  /**
   * Creates the guard of one history.
   *
   * @param objects - The document's objects map.
   * @param board - The store, read before each step is applied.
   */
  constructor(objects: Y.Map<unknown>, board: BoardReader) {
    this.#objects = objects;
    this.#board = board;
  }

  /**
   * Decides what a step about to be applied keeps. Call inside the undo or redo transaction,
   * before Yjs applies the step; then {@link CreationGuard.keeps} answers for it until
   * {@link CreationGuard.end}. Cost: the step's inserted and deleted structs, the items of each
   * incarnation of each object it would remove, and the keys of those objects' dependents
   * (children, attached connectors, pinned comments, through the board's reverse indexes).
   * Never the board.
   *
   * @param transaction - The open transaction.
   * @param step - The step.
   * @param isOwnDeletion - Whether a step on one of the history's stacks deleted an item.
   * @returns The step to hand Yjs (the step, or a copy without the restores it must not make),
   *   or `null` when the step must be used up unapplied because keeping an object would split
   *   it.
   */
  begin(
    transaction: Y.Transaction,
    step: UndoStep,
    isOwnDeletion: (id: Y.ID) => boolean,
  ): UndoStep | null {
    this.#kept = new Set();
    this.#keptValues = new Set();
    this.#protectedChildren.clear();
    const past = causalPastOf(step);
    if (past === undefined) return step;
    const { doc } = transaction;
    const scope = writerScopeOf(past, doc);
    for (const part of this.#groupSteps ?? [step]) {
      const partScope = { ...scope, past: causalPastOf(part) ?? past };
      if (this.#restoresTouchedInstance(transaction, part, partScope)) return null;
    }
    this.#keptValues = keptValues(transaction, step, this.#objects, scope);
    const blocked = blockedRestores(
      transaction,
      step,
      this.#objects,
      scope,
      isOwnDeletion,
      this.#keptValues,
    );
    const removed = removedEntries(transaction, step, this.#objects);
    const touched = [...removed]
      .filter(([id, entry]) => this.#isTouchedSince(id, entry, scope))
      .map(([id]) => id);
    const kept = this.#withRelated(touched, removed);
    if (kept.size > 0 && this.#wouldSplit(kept, removed, step, doc.store)) return null;
    for (const [id, entry] of removed) if (kept.has(id)) this.#kept.add(entry);
    for (const id of kept) this.#groupKept?.add(id);
    return withoutRestores(step, blocked);
  }

  /**
   * A detach changes an existing instance into a frame rather than creating its map. Undo
   * must not restore the leaf identity after another person wrote to that frame's children.
   *
   * @param transaction - The history transaction.
   * @param step - The step's deleted identity values.
   * @param scope - Which writes happened after the step.
   * @returns Whether applying the step would strand another person's work under an instance.
   */
  #restoresTouchedInstance(
    transaction: Y.Transaction,
    step: UndoStep,
    scope: WriterScope,
  ): boolean {
    let isBlocked = false;
    Y.iterateDeletedStructs(transaction, step.deletions, (item) => {
      if (!(item instanceof Y.Item) || item.parentSub !== 'identity') return;
      const parent = item.parent;
      if (!(parent instanceof Y.Map) || parent._item?.parent !== this.#objects) return;
      const id = parent._item.parentSub as ObjectId | null;
      if (id === null || this.#board.get(id)?.type !== 'frame') return;
      const identity: unknown = item.content.getContent()[0];
      if (
        identity === null ||
        typeof identity !== 'object' ||
        !('type' in identity) ||
        identity.type !== 'instance'
      )
        return;
      const subtree = this.#subtreeOf(id);
      const isTouched = [...subtree].some((child) => {
        const entry = this.#objects._map.get(child);
        return entry !== undefined && this.#isTouchedSince(child, entry, scope);
      });
      if (isTouched) {
        isBlocked = true;
        for (const child of subtree) this.#protectedChildren.add(child);
      }
    });
    return isBlocked;
  }

  /**
   * Every materialized descendant, with cycle protection for a transient merged hierarchy.
   *
   * @param root - The detached instance's frame.
   * @returns The whole subtree, including the root.
   */
  #subtreeOf(root: ObjectId): Set<ObjectId> {
    const result = new Set<ObjectId>();
    const pending = [root];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (result.has(id)) continue;
      result.add(id);
      pending.push(...this.#board.references.childrenOf(id));
    }
    return result;
  }

  /**
   * Explains a refused step, including children protecting a container identity change.
   *
   * @param transaction - Open history transaction.
   * @param step - The refused step.
   * @returns The affected objects and their editors, if known.
   */
  protection(transaction: Y.Transaction, step: UndoStep): UndoProtection | undefined {
    return protectionOf(transaction, step, this.#objects, this.#protectedChildren);
  }

  /**
   * Tells whether the step being applied must keep an item: the item is, or lies inside, an
   * object kept or a value kept (a label others typed into). Cost: a walk up the item's owners
   * to its object.
   *
   * @param item - An item Yjs is about to delete.
   * @returns `true` to keep it.
   */
  keeps(item: Y.Item): boolean {
    if (this.#kept.size === 0 && this.#keptValues.size === 0) return false;
    let entry = item;
    while (entry.parent !== this.#objects) {
      if (this.#keptValues.has(entry)) return true;
      const owner = (entry.parent as Y.AbstractType<unknown>)._item;
      if (owner === null) return false;
      entry = owner;
    }
    return this.#kept.has(entry);
  }

  /**
   * Whether the step being applied keeps an object it would remove (another person touched it).
   *
   * @returns True when it keeps one.
   */
  hasKept(): boolean {
    return this.#kept.size > 0;
  }

  /** Forgets the step, once it has been applied. */
  end(): void {
    this.#kept = new Set();
    this.#keptValues = new Set();
  }

  /**
   * Starts an undo or redo of a step written in parts (`undo-groups.ts`): until
   * {@link CreationGuard.endGroup}, an object one part keeps counts as touched for the parts
   * after it, so they keep what it lies in (its parent, up), as one step would.
   *
   * @param steps - All parts, used to protect detach before any part is reversed.
   */
  beginGroup(steps: readonly UndoStep[] = []): void {
    this.#groupSteps = steps.length === 0 ? undefined : steps;
    this.#groupKept = new Set();
  }

  /** Ends the undo or redo of a step written in parts. */
  endGroup(): void {
    this.#groupSteps = undefined;
    this.#groupKept = undefined;
  }

  /**
   * The objects that refer to an object, each with the keys holding the reference.
   *
   * @param id - The object.
   * @returns The dependents' ids and keys.
   */
  #dependentsOf(id: ObjectId): [ObjectId, ReferenceKey[]][] {
    const { references } = this.#board;
    const dependents: [ObjectId, ReferenceKey[]][] = [];
    for (const child of references.childrenOf(id)) dependents.push([child, ['placement']]);
    for (const instance of references.instancesOf(id)) dependents.push([instance, ['identity']]);
    for (const connectorId of references.connectorsAttachedTo(id)) {
      const connector = this.#board.get(connectorId);
      if (connector?.type !== 'connector') continue;
      const ends = (['from', 'to'] as const).filter((end) => {
        const value = connector[end];
        return value.kind === 'object' && value.objectId === id;
      });
      dependents.push([connectorId, ends]);
    }
    for (const comment of references.commentsAnchoredTo(id)) dependents.push([comment, ['anchor']]);
    return dependents;
  }

  /**
   * The incarnations of an object on the board now (see `incarnationsOf`), with their maps.
   *
   * @param id - The object.
   * @param store - The document's struct store.
   * @returns Each incarnation's entry and map; empty when the object is gone.
   */
  #incarnations(id: ObjectId, store: Y.Doc['store']): [Y.Item, Y.AbstractType<unknown>][] {
    const live = this.#objects._map.get(id);
    if (live === undefined || live.deleted) return [];
    return incarnationsOf(live, store).flatMap((entry) => {
      const map = mapOf(entry);
      return map === null ? [] : [[entry, map] as [Y.Item, Y.AbstractType<unknown>]];
    });
  }

  /**
   * Tells whether another person has touched an object the step would remove since the step:
   * written it (in any incarnation), written to a child of it, or made a connector or comment
   * refer to it; or, in a grouped step, an earlier part kept a child of it.
   *
   * @param id - The object.
   * @param entry - Its live entry.
   * @param scope - The step's scope.
   * @returns `true` to keep it.
   */
  #isTouchedSince(id: ObjectId, entry: Y.Item, scope: WriterScope): boolean {
    // A child an earlier part of the same grouped step kept.
    const groupKept = this.#groupKept;
    const children = [...this.#board.references.childrenOf(id)];
    if (groupKept !== undefined && children.some((child) => groupKept.has(child))) return true;
    for (const incarnation of incarnationsOf(entry, scope.store)) {
      if (isOthersSince(incarnation, scope)) return true;
      const map = mapOf(incarnation);
      if (map !== null && isObjectWrittenByOthers(map, scope, true)) return true;
    }
    return this.#dependentsOf(id).some(([dependentId, keys]) =>
      this.#incarnations(dependentId, scope.store).some(([dependent, map]) => {
        // A child: any write by another person. A connector or comment: its reference.
        if (keys[0] === 'placement') {
          return isOthersSince(dependent, scope) || isObjectWrittenByOthers(map, scope, false);
        }
        const editors = editorsSince(map, scope);
        return keys.some((key) => {
          const value = map._map.get(key);
          return value !== undefined && isKeyWrittenByOthers(value, scope, editors);
        });
      }),
    );
  }

  /**
   * The objects kept, with what the step also removes that they lie in (their parent, up) or
   * that lies inside them (a group's members, a frame's content, down).
   *
   * @param touched - The objects others touched.
   * @param removed - The objects the step would remove.
   * @returns The ids to keep.
   */
  #withRelated(
    touched: readonly ObjectId[],
    removed: ReadonlyMap<ObjectId, Y.Item>,
  ): Set<ObjectId> {
    const kept = new Set(touched);
    const pending = [...touched];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const parentId = this.#board.get(id)?.parentId ?? null;
      const related = [
        ...this.#board.references.childrenOf(id),
        ...(parentId === null ? [] : [parentId]),
      ];
      for (const other of related) {
        if (removed.has(other) && !kept.has(other)) {
          kept.add(other);
          pending.push(other);
        }
      }
    }
    return kept;
  }

  /**
   * Tells whether keeping objects would split the step: it also wrote a reference to one of
   * them in an object it does not remove (moved an existing object into a group it created),
   * and undoing that write while keeping the object would leave the object without what the
   * step put in it.
   *
   * @param kept - The objects kept.
   * @param removed - The objects the step would remove.
   * @param step - The step.
   * @param store - The document's struct store.
   * @returns `true` when the step cannot be applied in part.
   */
  #wouldSplit(
    kept: ReadonlySet<ObjectId>,
    removed: ReadonlyMap<ObjectId, Y.Item>,
    step: UndoStep,
    store: Y.Doc['store'],
  ): boolean {
    // Every incarnation of the dependent: an undone delete of it re-created its values as
    // copies, and the step's own write stays in the earlier map (fix round 2).
    return [...kept].some((id) =>
      this.#dependentsOf(id).some(
        ([dependentId, keys]) =>
          !removed.has(dependentId) &&
          this.#incarnations(dependentId, store).some(([, map]) =>
            keys.some((key) => {
              const value = map._map.get(key);
              return value !== undefined && Y.isDeleted(step.insertions, value.id);
            }),
          ),
      ),
    );
  }
}
