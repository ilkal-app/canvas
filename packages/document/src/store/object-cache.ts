import type * as Y from 'yjs';

import type { BoardObject, ObjectId, Page, PageId, TokenTable } from '@canvas/schema';

import type { DecodeIssue } from '../codec/decode-issue.js';
import { hiddenMemberIssues } from '../codec/hidden-member-issues.js';
import { fromYjs } from '../codec/object-codec.js';
import { firstPageIn, readPages } from '../pages/page-map.js';
import { isComponentContent } from '../repair/component-repair-scope.js';
import { LastKnownBoard } from '../repair/last-known-board.js';
import type { LastKnownObjects } from '../repair/last-known-objects.js';
import { readTokens } from '../tokens/token-map.js';

import type { BoardSnapshot } from './document-store.js';
import { InstanceReferenceOverlay } from './instance-reference-overlay.js';
import { ParentCycleOverlay } from './parent-cycle-overlay.js';
import { ReferenceIndex, type BoardReferences, type ObjectReplacement } from './reference-index.js';
import { ReferenceOverlay } from './reference-overlay.js';
import { SealedMap } from './sealed-map.js';
import type { StoreSide } from './side-maps.js';
import { hasStoredParentCycle } from './stored-parent-cycle.js';
import type { StyleTables } from './style-tables.js';

/**
 * The decoded side of the store: every readable object as a deep-frozen schema value, the
 * issues of unreadable entries and of network members a read hid, the reverse indexes and the
 * cached snapshot. Changed keys are
 * only marked when a transaction ends; they are decoded on the next read, so a burst of remote
 * updates (or loading a large board) decodes each object once, when someone looks. Objects that
 * leave the document are handed, as last decoded, to the store's {@link LastKnownObjects}. A
 * member of a stored parent cycle that the repair re-roots is shown re-rooted
 * ({@link ParentCycleOverlay}), in the snapshot, `get` and the reverse indexes alike;
 * {@link ObjectCache.stored} reads it as stored.
 */
export class ObjectCache implements BoardReferences {
  readonly #source: Y.Map<unknown>;
  readonly #pageSource: Y.Map<unknown>;
  #pages: ReadonlyMap<PageId, Page> | null = null;
  readonly #tokenSource: Y.Map<unknown>;
  #tokens: TokenTable | null = null;
  readonly #styles: StyleTables;
  readonly #objects = new Map<ObjectId, BoardObject>();
  readonly #issues = new Map<string, readonly DecodeIssue[]>();
  readonly #dirty = new Set<string>();
  readonly #references = new ReferenceIndex();
  readonly #lastKnown: LastKnownObjects;
  readonly #instanceCycles = new InstanceReferenceOverlay();
  readonly #cycles = new ParentCycleOverlay();
  readonly #projection = new ReferenceOverlay();
  #isReadOnly = false;
  #isAgentWriter = false;
  #snapshot: BoardSnapshot | null = null;

  /**
   * Creates the cache over a document's object map; every entry already in it is marked.
   *
   * @param source - The object map.
   * @param lastKnown - Where objects removed from the map are remembered, as last decoded.
   * @param side - The pages map (`pages/page-map.ts`), the colour tokens map
   *   (`tokens/token-map.ts`) and the named style tables (`style-tables.ts`).
   */
  constructor(source: Y.Map<unknown>, lastKnown: LastKnownObjects, side: StoreSide) {
    this.#source = source;
    this.#pageSource = side.pages;
    this.#tokenSource = side.tokens;
    this.#styles = side.styles;
    side.styles.onStale(() => {
      this.#snapshot = null;
    });
    this.#lastKnown = lastKnown;
    this.markChanged(source.keys());
  }

  /**
   * Marks entries as changed, to be decoded again on the next read.
   *
   * @param keys - The changed keys of the object map.
   */
  markChanged(keys: Iterable<string>): void {
    for (const key of keys) this.#dirty.add(key);
    if (this.#dirty.size > 0) this.#snapshot = null;
  }

  /** Marks the pages as changed, to be read again on the next read. */
  markPagesChanged(): void {
    this.#pages = null;
    this.#snapshot = null;
  }

  /**
   * The board's live pages as of the last completed transaction, read once per change.
   *
   * @returns The pages by id, in page order; never empty.
   */
  pages(): ReadonlyMap<PageId, Page> {
    this.#pages ??= new SealedMap(readPages(this.#pageSource));
    return this.#pages;
  }

  /** Marks the colour tokens as changed, to be read again on the next read. */
  markTokensChanged(): void {
    this.#tokens = null;
    this.#snapshot = null;
  }

  /**
   * The board's colour token table as of the last completed transaction, read once per change.
   *
   * @returns The entries by id, sorted.
   */
  tokens(): TokenTable {
    this.#tokens ??= new SealedMap(readTokens(this.#tokenSource));
    return this.#tokens;
  }

  /**
   * Selects virtual reference repair; role transitions invalidate the decoded view once.
   *
   * @param isReadOnly - Whether automatic repairs must remain in the view only.
   * @param isAgentWriter - Whether component content alone must remain projected.
   */
  setReadOnly(isReadOnly: boolean, isAgentWriter = false): void {
    if (this.#isReadOnly === isReadOnly && this.#isAgentWriter === isAgentWriter) return;
    this.#isAgentWriter = isAgentWriter;
    this.#isReadOnly = isReadOnly;
    this.markChanged([...this.#source.keys(), ...this.#projection.ids()]);
  }

  /**
   * One object as of the last completed transaction.
   *
   * @param id - The object id.
   * @returns The object, or `undefined`.
   */
  get(id: ObjectId): BoardObject | undefined {
    this.flush();
    return this.#objects.get(id);
  }

  /**
   * One object as stored, as of the last completed transaction: a member of a parent cycle the
   * reader shows re-rooted is read with its stored parent.
   *
   * @param id - The object id.
   * @returns The object, or `undefined`.
   */
  stored(id: ObjectId): BoardObject | undefined {
    this.flush();
    return (
      this.#instanceCycles.storedOf(id) ??
      this.#cycles.storedOf(id) ??
      this.#projection.storedOf(id) ??
      this.#objects.get(id)
    );
  }

  /**
   * The object a patch of its placement starts from: as the reader shows it when it shows it
   * re-rooted on a parent cycle ({@link ParentCycleOverlay.placementBase}), else as stored.
   * Reads the view of the last completed transaction without decoding anything.
   *
   * @param current - The object as stored now.
   * @returns The base of the patch.
   */
  placementBase(current: BoardObject): BoardObject {
    return this.#projection.placementBase(
      this.#instanceCycles.placementBase(this.#cycles.placementBase(current)),
      this.#objects.get(current.id),
    );
  }

  /**
   * The stored cycle roots a placement-changing command needs to materialize first.
   *
   * @param changed - The ids whose placement will change.
   * @returns The roots as shown to command validation.
   */
  cycleRepairs(changed: ReadonlySet<ObjectId>): readonly BoardObject[] {
    this.flush();
    const roots = new Map(this.#cycles.repairsFor(changed).map((root) => [root.id, root]));
    if (this.#isReadOnly || this.#isAgentWriter) {
      for (const root of this.#projection.cycleRepairs(changed)) roots.set(root.id, root);
    }
    return [...roots.values()].sort((first, second) => compare(first.id, second.id));
  }

  /**
   * The board as an immutable snapshot, cached until the next change.
   *
   * @returns The snapshot.
   */
  read(): BoardSnapshot {
    this.flush();
    this.#snapshot ??= Object.freeze({
      objects: new SealedMap(this.#objects),
      pages: this.pages(),
      tokens: this.tokens(),
      textStyles: this.#styles.table('text'),
      effectStyles: this.#styles.table('effect'),
      issues: Object.freeze(
        [
          ...this.#issues,
          ...this.#cycles.issues(),
          ...(this.#isReadOnly ? this.#projection.issues() : []),
        ]
          .flatMap(([, issues]) => issues)
          .sort(
            (first, second) => compare(first.key, second.key) || compare(first.code, second.code),
          ),
      ),
    });
    return this.#snapshot;
  }

  /**
   * Component placements currently projected at the root.
   *
   * @returns The exact placements writable clients should materialize.
   */
  instanceRepairs(): readonly BoardObject[] {
    this.flush();
    return this.#instanceCycles.repairs();
  }

  /** @inheritdoc */
  instancesOf(mainId: ObjectId): ReadonlySet<ObjectId> {
    this.flush();
    return this.#references.instancesOf(mainId);
  }

  /** @inheritdoc */
  childrenOf(parentId: ObjectId | null): ReadonlySet<ObjectId> {
    this.flush();
    return this.#references.childrenOf(parentId);
  }

  /** @inheritdoc */
  topChildOf(parentId: ObjectId | null): ObjectId | undefined {
    this.flush();
    return this.#references.topChildOf(parentId);
  }

  /** @inheritdoc */
  connectorsAttachedTo(objectId: ObjectId): ReadonlySet<ObjectId> {
    this.flush();
    return this.#references.connectorsAttachedTo(objectId);
  }

  /** @inheritdoc */
  commentsAnchoredTo(objectId: ObjectId): ReadonlySet<ObjectId> {
    this.flush();
    return this.#references.commentsAnchoredTo(objectId);
  }

  /**
   * Materializes only notifications that can include virtual repairs. Acyclic writable changes
   * preserve the cache's lazy decode and removed-object memory timing.
   *
   * @returns Visible replacements, or none when raw changed keys are sufficient.
   */
  flushForNotification(): readonly ObjectReplacement[] {
    if (
      this.#isReadOnly ||
      this.#isAgentWriter ||
      this.#instanceCycles.hasInstances() ||
      this.#cycles.ids().next().done !== true ||
      this.#instanceCycles.ids().next().done !== true ||
      hasStoredParentCycle(this.#source, this.#dirty)
    )
      return this.flush();
    return [];
  }

  /**
   * Decodes every marked entry, updating the objects, the issues (an unreadable entry's, or the
   * network members a path's read hid), the parent cycles shown broken and the reverse indexes,
   * and remembers the objects removed from the document (not those only unreadable for now).
   * The store calls it before a transaction starts, so reads made during the transaction still
   * show the last completed one.
   *
   * @returns The visible replacements, including virtual repairs.
   */
  flush(): readonly ObjectReplacement[] {
    if (this.#dirty.size === 0) return [];
    const dirty = new Set([...this.#dirty] as ObjectId[]);
    this.#dirty.clear();
    const shownBefore = new Map<ObjectId, BoardObject | undefined>();
    const remember = (id: ObjectId) => {
      if (!shownBefore.has(id)) shownBefore.set(id, this.#objects.get(id));
    };
    const projected = [...this.#projection.ids(), ...this.#instanceCycles.ids()];
    for (const id of [...dirty, ...this.#cycles.ids(), ...projected]) remember(id);
    this.#instanceCycles.restore(this.#objects);
    this.#projection.restore(this.#objects);
    // Back to the stored values, then the change, then the cycles found on them shown broken.
    for (const id of this.#cycles.ids()) this.#setObject(id, this.#cycles.storedOf(id));
    const removed = this.#decode(dirty, shownBefore);
    this.#cycles.update(dirty, (id) => this.#objects.get(id));
    for (const id of this.#cycles.ids()) {
      remember(id);
      this.#setObject(id, this.#cycles.shownOf(id));
    }
    this.#instanceCycles.update(this.#objects, shownBefore, remember);
    this.#lastKnown.recordRemoved(removed);
    this.#references.apply(
      [...shownBefore].map(([id, previous]) => ({ previous, next: this.#objects.get(id) })),
    );
    if (this.#isReadOnly || this.#isAgentWriter) {
      this.#projection.project(
        this.#objects,
        this.#references,
        this.#lastKnown,
        new Set([...dirty, ...projected]),
        (id) => this.#source.has(id),
        remember,
        () => firstPageIn(this.pages()),
        (previous, next) => {
          if (this.#isReadOnly) return true;
          const before = new LastKnownBoard(
            { get: (id) => this.#objects.get(id), references: this.#references },
            this.#lastKnown,
          );
          const get = (id: ObjectId) => before.get(id);
          return isComponentContent(previous, get) || isComponentContent(next, get);
        },
      );
    }
    const replacements: ObjectReplacement[] = [];
    for (const [id, previous] of shownBefore) {
      const next = this.#objects.get(id);
      if (previous !== next || dirty.has(id)) replacements.push({ previous, next });
    }
    return replacements;
  }

  /**
   * Decodes entries into the objects as stored and records their issues.
   *
   * @param ids - The entries to decode.
   * @param shownBefore - Each entry's object as last shown.
   * @returns The objects the document no longer holds, as last shown.
   */
  #decode(ids: Iterable<ObjectId>, shownBefore: ReadonlyMap<ObjectId, BoardObject | undefined>) {
    const removed: BoardObject[] = [];
    for (const id of ids) {
      this.#issues.delete(id);
      let next: BoardObject | undefined;
      if (this.#source.has(id)) {
        this.#lastKnown.forget(id);
        const value = this.#source.get(id);
        const decoded = fromYjs(id, value);
        if ('object' in decoded) next = decoded.object;
        const issues = next === undefined ? [] : hiddenMemberIssues(id, value, next);
        if ('issue' in decoded) issues.push(decoded.issue);
        if (issues.length > 0) this.#issues.set(id, issues);
      } else {
        const previous = shownBefore.get(id);
        if (previous !== undefined) removed.push(previous);
      }
      this.#setObject(id, next);
    }
    return removed;
  }

  /**
   * Sets or removes one object of the decoded view.
   *
   * @param id - The object id.
   * @param object - The object, or `undefined` to remove it.
   */
  #setObject(id: ObjectId, object: BoardObject | undefined): void {
    if (object === undefined) this.#objects.delete(id);
    else this.#objects.set(id, object);
  }
}

/**
 * Compares issue keys or codes by UTF-16 units, including equality.
 *
 * @param first - The first value.
 * @param second - The second value.
 * @returns Their ordering.
 */
function compare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
