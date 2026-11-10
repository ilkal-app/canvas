import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  findInstanceReferenceBreaks,
  type InstanceReferenceBreak,
} from '../repair/instance-reference-breaks.js';

import { isSamePlacement } from './parent-cycle-overlay.js';

/** Reader-first component reference repairs; the writer materializes these exact placements. */
export class InstanceReferenceOverlay {
  #entries = new Map<ObjectId, InstanceReferenceBreak>();
  readonly #instances = new Set<ObjectId>();

  /**
   * Whether existing references could gain a new cycle from an incoming placement.
   *
   * @returns True when notifications need the current projected graph.
   */
  hasInstances(): boolean {
    return this.#instances.size > 0;
  }

  /**
   * Identities currently projected to the root.
   *
   * @returns The projected identities.
   */
  ids(): IterableIterator<ObjectId> {
    return this.#entries.keys();
  }

  /**
   * Reads the original placement of a projected identity.
   *
   * @param id - Object identity.
   * @returns Original stored value when projected.
   */
  storedOf(id: ObjectId): BoardObject | undefined {
    return this.#entries.get(id)?.stored;
  }

  /**
   * Current placements to materialize in a system transaction.
   *
   * @returns Source instances at their projected root placements.
   */
  repairs(): readonly BoardObject[] {
    return [...this.#entries.values()].map(({ shown }) => shown);
  }

  /**
   * Restores raw decoded objects before applying another change.
   *
   * @param objects - Cache to restore.
   */
  restore(objects: Map<ObjectId, BoardObject>): void {
    for (const [id, entry] of this.#entries) objects.set(id, entry.stored);
  }

  /**
   * Preserves the projected coordinate frame when a command patches a stored placement.
   *
   * @param current - Stored object during a transaction.
   * @returns Its shown placement when it still matches the projection's source.
   */
  placementBase(current: BoardObject): BoardObject {
    const entry = this.#entries.get(current.id);
    if (entry === undefined || !isSamePlacement(entry.stored, current)) return current;
    const { parentId, pageId, x, y, rotation } = entry.shown;
    return { ...current, parentId, pageId, x, y, rotation };
  }

  /**
   * Recomputes reference repairs only when changes can affect the graph or an existing repair.
   *
   * @param objects - Decoded board after parent-cycle projection.
   * @param previous - Values before the change, keyed by every touched identity.
   * @param remember - Captures an affected value before this overlay changes it.
   */
  update(
    objects: Map<ObjectId, BoardObject>,
    previous: ReadonlyMap<ObjectId, BoardObject | undefined>,
    remember: (id: ObjectId) => void,
  ): void {
    let isChanged = this.#entries.size > 0;
    for (const [id, before] of previous) {
      const next = objects.get(id);
      if (next?.type === 'instance') this.#instances.add(id);
      else this.#instances.delete(id);
      isChanged ||=
        before?.parentId !== next?.parentId ||
        before?.type !== next?.type ||
        (next?.type === 'instance' &&
          (before?.type !== 'instance' || before.mainId !== next.mainId));
    }
    if (!isChanged || this.#instances.size === 0) {
      this.#entries.clear();
      return;
    }
    const prior = this.#entries;
    this.#entries = new Map();
    for (const entry of findInstanceReferenceBreaks({ objects })) {
      remember(entry.stored.id);
      const old = prior.get(entry.stored.id);
      const shown =
        old?.stored === entry.stored && isSamePlacement(old.shown, entry.shown)
          ? old.shown
          : Object.freeze(entry.shown);
      this.#entries.set(entry.stored.id, { ...entry, shown });
      objects.set(entry.stored.id, shown);
    }
  }
}
