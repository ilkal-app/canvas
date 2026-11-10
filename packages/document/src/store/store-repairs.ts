import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { LastKnownBoard } from '../repair/last-known-board.js';
import type { LastKnownObjects } from '../repair/last-known-objects.js';

import { repairView } from './cache-views.js';
import type { ChangeSet, DocumentStore, RepairMode } from './document-store.js';
import type { ObjectCache } from './object-cache.js';
import { repairAfter } from './repair-after.js';
import { repairStoreReferences } from './repair-store-references.js';
import type { StoreSide } from './side-maps.js';
import { viewTransition } from './visible-changes.js';

/** What a `YjsDocumentStore` hands its repairs. */
export interface StoreRepairParts {
  /** The store. */
  readonly store: DocumentStore;
  /** Its objects map. */
  readonly objects: Y.Map<unknown>;
  /** Its decoded view. */
  readonly cache: ObjectCache;
  /** The objects removed from the board, as last seen. */
  readonly lastKnown: LastKnownObjects;
  /** Its pages, tokens and named styles. */
  readonly side: StoreSide;
  /** The repair mode it starts in. */
  readonly mode: RepairMode;
}

/**
 * A store's automatic repairs: its repair mode and its reference repair (`repairStoreReferences`),
 * run after updates and undo/redo in system transactions excluded from undo history. Empty passes
 * write nothing. Component cycles and excessive depth are projected first, then materialized only
 * for human writers; agents retain legacy repair authority without changing foreign main
 * definitions. Page deletion moves orphan roots to the first live page.
 */
export class StoreRepairs {
  readonly #parts: StoreRepairParts;
  /** The board now, as the reference repair reads it. */
  readonly #view: ReturnType<typeof repairView>;
  #mode: RepairMode;

  /**
   * Sets the store's repairs up.
   *
   * @param parts - The store's parts.
   */
  constructor(parts: StoreRepairParts) {
    this.#parts = parts;
    this.#view = repairView(parts.cache, parts.objects);
    this.#mode = parts.mode;
    parts.cache.setReadOnly(this.#mode === 'read-only');
  }

  /**
   * The repair mode.
   *
   * @returns The mode.
   */
  get mode(): RepairMode {
    return this.#mode;
  }

  /**
   * Repairs references, pages and parent cycles after a change.
   *
   * @param touched - The objects the change created, changed or removed.
   * @param isPagesChanged - Whether the change changed the pages.
   * @returns The repaired ids, sorted.
   */
  references(touched: ReadonlySet<ObjectId>, isPagesChanged = false): ObjectId[] {
    const { store, cache, lastKnown, side } = this.#parts;
    return repairStoreReferences(
      {
        store,
        cache,
        before: new LastKnownBoard(store, lastKnown),
        view: this.#view,
        mode: this.#mode,
        changedStyles: side.styles.takeChanged(),
      },
      touched,
      isPagesChanged,
    );
  }

  /**
   * Switches the repair mode: the decoded view changes at once, its listeners hear what became
   * visible or hidden, and, unless now read-only, every object is repaired.
   *
   * @param mode - The new mode.
   * @param deliver - Delivers the view's change set to the store's listeners.
   * @param isDestroyed - Whether the store was destroyed meanwhile.
   */
  switchMode(
    mode: RepairMode,
    deliver: (changes: ChangeSet) => void,
    isDestroyed: () => boolean,
  ): void {
    const { cache, objects } = this.#parts;
    this.#mode = mode;
    cache.setReadOnly(mode === 'read-only', mode === 'agent-write');
    const replacements = cache.flush();
    repairAfter(
      () => {
        if (replacements.length > 0) deliver(viewTransition(replacements));
      },
      () => {
        if (mode !== 'read-only' && !isDestroyed()) {
          this.references(new Set(objects.keys()) as Set<ObjectId>, true);
        }
      },
    );
  }
}
