import type { BoardReader, ChangeSet } from '@canvas/document';
import { isStoredHidden, type BoardObject, type ObjectId } from '@canvas/schema';

import { restructureRows } from './layer-restructure.js';
import { LayerRowIndex } from './layer-row-index.js';
import { buildLayerRows, layerNameOf, type LayerRow } from './layer-rows.js';

/** Past how many renamed or locked rows one pass over the rows beats a lookup for each. */
const MAX_LOOKUP_PATCHES = 16;

/** What decides an object's place in the tree: its parent and its stacking key. */
interface Place {
  /** Its parent, or null at the root. */
  readonly parentId: ObjectId | null;
  /** Its stacking key. */
  readonly z: string;
}

/**
 * An object's place.
 *
 * @param object - The object.
 * @returns Its parent and key.
 */
function placeOf(object: BoardObject): Place {
  return { parentId: object.parentId, z: object.z };
}

/**
 * Schedules a callback for the next animation frame.
 *
 * @param callback - What to run.
 * @returns A function that cancels it.
 */
export type ScheduleFrame = (callback: () => void) => () => void;

/** Options of a {@link LayerTree}. */
export interface LayerTreeOptions {
  /**
   * Schedules the pass that applies queued change sets (`queueChanges`), once per burst; the
   * page passes `requestAnimationFrame`. If absent, queued change sets apply at once.
   */
  readonly scheduleFrame?: ScheduleFrame;
}

/** The structural part of a batch of changes, as `restructureRows` takes it. */
interface Structure {
  /** Each parent whose children changed, with the children that did. */
  readonly changedChildren: Map<ObjectId | null, Set<ObjectId>>;
  /** The parents whose slices changed. */
  readonly dirty: Set<ObjectId | null>;
}

/**
 * The layers panel's model (50k objects stay responsive): the rows, which frames and groups are
 * expanded, and a version for React. It follows the document's change sets: a create, delete,
 * reparent or restack splices only the affected parents' slices of rows (`restructureRows`,
 *); a rename or a lock patches its row; a move, resize or restyle costs one lookup per
 * object. Remote change sets can be queued (`queueChanges`) and applied together in one pass per
 * animation frame. It remembers every object's parent and key to tell, walking the board once when
 * made. Main thread.
 */
export class LayerTree {
  private readonly board: BoardReader;
  private readonly scheduleFrame: ScheduleFrame | undefined;
  private readonly places = new Map<ObjectId, Place>();
  private readonly expandedIds = new Set<ObjectId>();
  private readonly listeners = new Set<() => void>();
  private readonly index = new LayerRowIndex();
  /** The objects the queued change sets changed: at most one entry per object, however many. */
  private readonly queued = new Set<ObjectId>();
  private cancelFrame: (() => void) | undefined;
  private currentRows: readonly LayerRow[] = [];
  /** 1 once the first rows are built. */
  private currentVersion = 1;

  /**
   * Walks the board once and builds the rows, every frame and group collapsed.
   *
   * @param board - The document.
   * @param options - How to schedule queued change sets.
   */
  constructor(board: BoardReader, options: LayerTreeOptions = {}) {
    this.board = board;
    this.scheduleFrame = options.scheduleFrame;
    const pending: (ObjectId | null)[] = [null];
    for (let parentId = pending.pop(); parentId !== undefined; parentId = pending.pop()) {
      for (const id of board.references.childrenOf(parentId)) {
        const object = board.get(id);
        if (object === undefined) continue;
        this.places.set(id, placeOf(object));
        pending.push(id);
      }
    }
    this.currentRows = buildLayerRows(board, this.expandedIds);
    this.index.reset(this.currentRows);
  }

  /**
   * The rows now, top to bottom; a new array whenever they change.
   *
   * @returns The rows.
   */
  rows(): readonly LayerRow[] {
    return this.currentRows;
  }

  /**
   * Increases whenever the rows change, for `useSyncExternalStore`.
   *
   * @returns The version.
   */
  version(): number {
    return this.currentVersion;
  }

  /**
   * The row index of an object, if it is listed: O(1) once indexed (`LayerRowIndex`).
   *
   * @param id - The object.
   * @returns The index, or undefined when it is not listed (inside a collapsed parent).
   */
  indexOf(id: ObjectId): number | undefined {
    return this.index.indexOf(id);
  }

  /**
   * Expands or collapses frames or groups, splicing their slices in one pass (queued change
   * sets first).
   *
   * @param ids - The containers.
   * @param isExpanded - Whether to list their children.
   */
  setExpanded(ids: readonly ObjectId[], isExpanded: boolean): void {
    this.flushQueued();
    const changed = ids.filter((id) => this.expandedIds.has(id) !== isExpanded);
    if (changed.length === 0) return;
    for (const id of changed) {
      if (isExpanded) this.expandedIds.add(id);
      else this.expandedIds.delete(id);
    }
    this.restructure({ changedChildren: new Map(), dirty: new Set(changed) });
  }

  /**
   * Expands every ancestor of an object, so its row is listed (a selection made on the canvas):
   * O(depth), plus the splice of the ancestors' slices.
   *
   * @param id - The object.
   */
  reveal(id: ObjectId): void {
    this.flushQueued();
    const collapsed: ObjectId[] = [];
    const seen = new Set<ObjectId>();
    let parentId = this.board.get(id)?.parentId;
    while (parentId != null && !seen.has(parentId)) {
      seen.add(parentId);
      if (!this.expandedIds.has(parentId)) collapsed.push(parentId);
      parentId = this.board.get(parentId)?.parentId;
    }
    this.setExpanded(collapsed, true);
  }

  /**
   * Follows one of the document's change sets now, with any queued before it, in one pass.
   *
   * @param changes - What a transaction changed.
   */
  applyChanges(changes: ChangeSet): void {
    this.enqueue(changes);
    this.flushQueued();
  }

  /**
   * Queues a change set (a remote one) for the next scheduled pass, so a burst of them (a
   * collaborator's paste) costs one pass per animation frame, not one per change set. Applies
   * at once when the tree has no scheduler.
   *
   * @param changes - What a transaction changed.
   */
  queueChanges(changes: ChangeSet): void {
    this.enqueue(changes);
    if (this.scheduleFrame === undefined) {
      this.flushQueued();
      return;
    }
    this.cancelFrame ??= this.scheduleFrame(() => {
      this.cancelFrame = undefined;
      this.flushQueued();
    });
  }

  /** Drops the queued change sets and cancels their pass: the panel has gone. */
  dispose(): void {
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.queued.clear();
  }

  /**
   * Calls `listener` whenever the rows change.
   *
   * @param listener - The callback.
   * @returns A function that unsubscribes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notes the objects a change set changed, for the next pass: a hidden tab, whose animation
   * frames stop, holds at most one entry per object however many change sets arrive.
   *
   * @param changes - What a transaction changed.
   */
  private enqueue(changes: ChangeSet): void {
    for (const id of changes.deleted) this.queued.add(id);
    for (const id of changes.created) this.queued.add(id);
    for (const id of changes.updated) this.queued.add(id);
  }

  /**
   * Applies the queued change sets in one pass: each changed object is compared with the place
   * remembered for it, so the order of the sets does not matter. Changed places splice the
   * rows (`restructure`); the other listed objects have their names and locks patched.
   */
  private flushQueued(): void {
    if (this.queued.size === 0) return;
    const ids = [...this.queued];
    this.dispose();
    const structure: Structure = { changedChildren: new Map(), dirty: new Set() };
    const patched: ObjectId[] = [];
    for (const id of ids) {
      if (!this.follow(id, structure)) patched.push(id);
    }
    if (structure.dirty.size > 0) this.restructure(structure);
    this.patch(patched);
  }

  /**
   * Updates an object's remembered place, noting the parents whose children changed.
   *
   * @param id - A changed object.
   * @param structure - Receives the changed parents.
   * @returns Whether its place changed (else only its row's name or lock can have).
   */
  private follow(id: ObjectId, structure: Structure): boolean {
    const before = this.places.get(id);
    const object = this.board.get(id);
    const note = (parentId: ObjectId | null) => {
      const children = structure.changedChildren.get(parentId) ?? new Set();
      children.add(id);
      structure.changedChildren.set(parentId, children);
      structure.dirty.add(parentId);
    };
    if (object === undefined) {
      if (before === undefined) return false;
      this.places.delete(id);
      note(before.parentId);
      return true;
    }
    const after = placeOf(object);
    if (before?.parentId === after.parentId && before.z === after.z) return false;
    if (before !== undefined && before.parentId !== after.parentId) note(before.parentId);
    note(after.parentId);
    this.places.set(id, after);
    return true;
  }

  /**
   * Splices the slices of the changed parents into the rows (`restructureRows`).
   *
   * @param structure - The changed parents.
   */
  private restructure(structure: Structure): void {
    const next = restructureRows({
      board: this.board,
      expandedIds: this.expandedIds,
      rows: this.currentRows,
      index: this.index,
      ...structure,
    });
    if (next === undefined) return;
    this.currentRows = next.rows;
    this.index.splice(next.rows, next.changedFrom, next.removed, next.added);
    this.changed();
  }

  /**
   * Brings the names and locks of listed objects up to date without moving any row: a lookup
   * per object, plus one copy of the rows when a name or lock did change (one mapping pass
   * instead of a lookup each, when many did).
   *
   * @param ids - Changed objects whose places did not change.
   */
  private patch(ids: readonly ObjectId[]): void {
    const replaced = new Map<ObjectId, LayerRow>();
    for (const id of ids) {
      const row = this.index.rowOf(id);
      const object = this.board.get(id);
      if (row === undefined || object === undefined) continue;
      const name = layerNameOf(object);
      const isHidden = isStoredHidden(object);
      if (row.name === name && row.isLocked === object.locked && row.isHidden === isHidden) {
        continue;
      }
      replaced.set(id, { ...row, name, isLocked: object.locked, isHidden });
    }
    if (replaced.size === 0) return;
    let rows: LayerRow[];
    if (replaced.size > MAX_LOOKUP_PATCHES) {
      rows = this.currentRows.map((row) => replaced.get(row.id) ?? row);
    } else {
      rows = [...this.currentRows];
      for (const [id, row] of replaced) {
        const at = this.index.indexOf(id);
        if (at !== undefined) rows[at] = row;
      }
    }
    this.currentRows = rows;
    this.index.replace(rows, [...replaced.values()]);
    this.changed();
  }

  private changed(): void {
    this.currentVersion += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
