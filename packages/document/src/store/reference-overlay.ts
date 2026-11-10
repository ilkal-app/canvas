import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import { deepFreeze } from '../codec/deep-freeze.js';
import { LastKnownBoard } from '../repair/last-known-board.js';
import type { LastKnownObjects } from '../repair/last-known-objects.js';
import { planReferenceRepair } from '../repair/reference-repair.js';

import { validateObject } from './object-validation.js';
import { isSamePlacement, ParentCycleOverlay } from './parent-cycle-overlay.js';
import type { ReferenceIndex } from './reference-index.js';

/** Read-only reference repairs, restored before the next change is projected. */
export class ReferenceOverlay {
  readonly #stored = new Map<ObjectId, BoardObject>();
  readonly #cycles = new ParentCycleOverlay();

  /**
   * Lists active virtual replacements.
   *
   * @returns The ids whose stored values the projection replaces or hides.
   */
  ids(): IterableIterator<ObjectId> {
    return this.#stored.keys();
  }

  /**
   * Restores the input values before a later change is decoded.
   *
   * @param objects - The mutable decoded view.
   */
  restore(objects: Map<ObjectId, BoardObject>): void {
    for (const [id, object] of this.#stored) objects.set(id, object);
    this.#stored.clear();
  }

  /**
   * Reads through a virtual replacement or deletion.
   *
   * @param id - The object id.
   * @returns Its value before projection, if projected.
   */
  storedOf(id: ObjectId): BoardObject | undefined {
    return this.#stored.get(id);
  }

  /**
   * Bases explicit placement edits on the projected frame, without changing automatic policy.
   *
   * @param current - The object currently stored in the transaction.
   * @param shown - Its current projected value.
   * @returns The projected placement when the stored placement is still the input it describes.
   */
  placementBase(current: BoardObject, shown: BoardObject | undefined): BoardObject {
    const stored = this.#stored.get(current.id);
    if (stored === undefined || shown === undefined || !isSamePlacement(stored, current))
      return current;
    const { parentId, x, y, rotation } = shown;
    return { ...current, parentId, x, y, rotation };
  }

  /**
   * Roots of cycles closed by reference projection that a command needs to materialize.
   *
   * @param changed - Placement-changing ids.
   * @returns The projected roots.
   */
  cycleRepairs(changed: ReadonlySet<ObjectId>): readonly BoardObject[] {
    return this.#cycles.repairsFor(changed);
  }

  /**
   * Reports cycles closed by the reference projection.
   *
   * @returns Their issues, shown broken without writes.
   */
  issues(): ReturnType<ParentCycleOverlay['issues']> {
    return this.#cycles.issues();
  }

  /**
   * Applies the writer's pure reference plan and subsequent cycle break to the decoded view.
   * Validation matches ordinary repair writes; an invalid unrelated field is not bypassed.
   *
   * @param objects - The decoded view, with stored cycles already shown broken.
   * @param references - Indexes of that view, updated as projection changes it.
   * @param lastKnown - Removed objects used to preserve geometry.
   * @param touched - Changed ids plus prior projection ids, so restored references are revisited.
   * @param isPresent - Whether the source still holds an entry, readable or otherwise.
   * @param remember - Records a value before its first visible replacement.
   * @param firstPageId - The board's first page, where a re-rooted object of no known page goes.
   * @param shouldProject - Whether this repair remains virtual for the current writer.
   */
  project(
    objects: Map<ObjectId, BoardObject>,
    references: ReferenceIndex,
    lastKnown: LastKnownObjects,
    touched: Iterable<ObjectId>,
    isPresent: (id: ObjectId) => boolean,
    remember: (id: ObjectId) => void,
    firstPageId: () => PageId,
    shouldProject: (before: BoardObject, after: BoardObject | undefined) => boolean,
  ): void {
    const get = (id: ObjectId) => objects.get(id);
    const before = new LastKnownBoard({ get, references }, lastKnown);
    const plan = planReferenceRepair({ get, isPresent }, before, touched);
    const replace = (id: ObjectId, next: BoardObject | undefined) => {
      const previous = objects.get(id);
      if (previous === undefined || !shouldProject(previous, next)) return;
      remember(id);
      if (!this.#stored.has(id)) this.#stored.set(id, previous);
      if (next === undefined) objects.delete(id);
      else objects.set(id, deepFreeze(next));
      references.apply([{ previous, next }]);
    };
    for (const id of plan.deleted) replace(id, undefined);
    for (const planned of plan.updated) {
      // A writer's store settles a re-rooted object's page on the first page; so does the view.
      const object =
        planned.parentId === null && typeof planned.pageId !== 'string'
          ? { ...planned, pageId: firstPageId() }
          : planned;
      if (validateObject(object, get(object.id)).isValid) replace(object.id, object);
    }
    this.#cycles.update(
      plan.updated.map(({ id }) => id),
      get,
    );
    for (const id of this.#cycles.ids()) replace(id, this.#cycles.shownOf(id));
  }
}
