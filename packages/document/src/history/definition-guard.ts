import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';

import type { CreationGuard } from './creation-guard.js';
import type { UndoStep } from './field-guard.js';
import { removedEntries } from './removed-entries.js';

/** Retains definitions for offline instances when undo would physically remove their maps. */
export class DefinitionGuard {
  readonly #objects: Y.Map<unknown>;
  readonly #board: BoardReader;
  #kept = new Set<Y.Item>();
  #mains: ObjectId[] = [];
  #groupSteps: readonly UndoStep[] | undefined;

  /**
   * Creates one history's definition guard.
   *
   * @param objects - The live object maps.
   * @param board - The board before the history step.
   */
  constructor(objects: Y.Map<unknown>, board: BoardReader) {
    this.#objects = objects;
    this.#board = board;
  }

  /**
   * Keeps removed mains and only the descendants the same step would remove.
   * Existing members may return to their former parents, leaving a hollow retired main.
   *
   * @param transaction - The open undo transaction.
   * @param step - The fully guarded step to apply.
   * @param creation - The guard protecting known foreign edits.
   */
  begin(transaction: Y.Transaction, step: UndoStep, creation: CreationGuard): void {
    this.end();
    const removed = removedEntries(transaction, step, this.#objects);
    const allRemoved = new Map(removed);
    for (const part of this.#groupSteps ?? []) {
      for (const [id, item] of removedEntries(transaction, part, this.#objects))
        allRemoved.set(id, item);
    }
    for (const [id, entry] of allRemoved) {
      if (this.#board.get(id)?.type !== 'component' || creation.keeps(entry)) continue;
      if (removed.has(id)) this.#mains.push(id);
      const pending = [id];
      for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
        const item = allRemoved.get(child);
        if (item === undefined || this.#kept.has(item)) continue;
        this.#kept.add(item);
        pending.push(...this.#board.references.childrenOf(child));
      }
    }
  }

  /**
   * Keeps a retained object's map and nested content.
   *
   * @param item - An item Yjs would remove.
   * @returns Whether deletion must be suppressed.
   */
  keeps(item: Y.Item): boolean {
    if (this.#kept.size === 0) return false;
    let entry = item;
    while (entry.parent !== this.#objects) {
      const owner = (entry.parent as Y.AbstractType<unknown>)._item;
      if (owner === null) return false;
      entry = owner;
    }
    return this.#kept.has(entry);
  }

  /**
   * Retires inside the undo transaction so redo records the flag's inverse, even for an empty
   * main whose suppressed deletion made Yjs report no change. Does not stamp another edit.
   *
   * @returns Whether any retirement flag changed.
   */
  retire(): boolean {
    let hasChanged = false;
    for (const id of this.#mains) {
      const map = this.#objects.get(id);
      if (!(map instanceof Y.Map) || map.get('retired') === true) continue;
      map.set('retired', true);
      hasChanged = true;
    }
    return hasChanged;
  }

  /**
   * Makes every part of one logical creation visible before undo starts deleting children.
   *
   * @param steps - The group's unmodified history parts.
   */
  beginGroup(steps: readonly UndoStep[]): void {
    this.#groupSteps = steps;
  }

  /** Forgets the group's history parts. */
  endGroup(): void {
    this.#groupSteps = undefined;
  }

  /** Forgets the completed or refused step. */
  end(): void {
    this.#kept.clear();
    this.#mains = [];
  }
}
