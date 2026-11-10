import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { getRootMoveBatch } from '../scene/root-move-batch.js';
import { isRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { worldTransformOf } from '../scene/world-transform.js';

import { isFiniteBounds, isSameBox, unionBounds } from './bounds.js';
import { ClippedBoxes } from './clipped-boxes.js';
import { DrawingChangeLog } from './drawing-change-log.js';
import { MovingBoxes } from './moving-boxes.js';
import { isMovingListed } from './moving-listed.js';
import { worldBoundsOf } from './object-world-bounds.js';
import { ParentLinks } from './parent-links.js';
import { RTree, type RTreeOptions } from './r-tree.js';
import type { SpatialSearch } from './spatial-search.js';

/** How one re-indexed object's box changed. */
export interface IndexedBoxChange {
  /** Its box before the change, world units, or `undefined` when it was not indexed. */
  readonly previous: WorldBounds | undefined;
  /** Its box now, world units, or `undefined` when it is not indexed. */
  readonly next: WorldBounds | undefined;
}

/**
 * The spatial index of a scene: an {@link RTree} of every object's world box
 * (`worldBoundsOf`), kept in step with the document through the same change sets the `Scene`
 * applies. Groups have no box of their own; their children are indexed
 * individually with world-space boxes, so a query never needs to descend a group. A change to
 * an object re-indexes it and every descendant, since their world transforms compose its (the
 * scene's transform resolution, `worldTransformOf`). The first change set into an empty index is
 * bulk-loaded. A box is what the object's clipping ancestors leave of it (`clipChainOf`,
 * cut by `clipBounds`, a turned box exactly), its drawing bounds cut alike, so culling and hit
 * testing see what is drawn; an object they leave nothing of is not indexed
 * (`isClippedAway`). A frame's move, resize or clip toggle re-indexes its descendants, which
 * re-clips them. Main thread or the engine worker, beside the scene it mirrors.
 */
export class SceneSpatialIndex implements SpatialSearch {
  private readonly tree: RTree;
  private readonly drawing = new Map<
    ObjectId,
    { base: WorldBounds | undefined; extra: WorldBounds }
  >();
  private readonly clips = new ClippedBoxes();
  /** Root leaves a retained move is placing, out of the tree while they move. */
  private readonly moving = new MovingBoxes();
  /** Changes to asynchronous drawing bounds, independent of document changes, by object. */
  readonly drawingChanges = new DrawingChangeLog();
  /** Every mirrored object's parent id, indexed or not. */
  private readonly parents = new ParentLinks();

  /**
   * Creates an empty index.
   *
   * @param options - The R-tree's node capacity.
   * @throws {RangeError} When the capacity is invalid (see `RTree`).
   */
  constructor(options: RTreeOptions = {}) {
    this.tree = new RTree(options);
  }

  /**
   * Changes to asynchronous drawing bounds, independent of document changes.
   *
   * @returns The revision (`drawingChanges.revision`).
   */
  get drawingBoundsRevision(): number {
    return this.drawingChanges.revision;
  }

  /**
   * The number of indexed objects (groups and comments are not indexed).
   *
   * @returns The count.
   */
  get size(): number {
    return this.tree.size + this.moving.size;
  }

  /**
   * How many indexed objects a retained move is placing.
   *
   * @returns The count.
   */
  get movingCount(): number {
    return this.moving.size;
  }

  /**
   * How many objects with a box are left out of the index because their clipping ancestors leave
   * nothing of them. They are drawn only when a pass draws its whole buffer, where the
   * GPU clips them to nothing; a culler that wants to skip them draws by membership instead.
   *
   * @returns The count.
   */
  get clippedAwayCount(): number {
    return this.clips.awayCount;
  }

  /**
   * Whether an object has a box its clipping ancestors leave nothing of, so it is not indexed
   * and draws nothing.
   *
   * @param id - The object.
   * @returns True when it is clipped away.
   */
  isClippedAway(id: ObjectId): boolean {
    return this.clips.isAway(id);
  }

  /**
   * The union of every indexed box.
   *
   * @returns The box, world units, or `undefined` when nothing is indexed.
   */
  get bounds(): WorldBounds | undefined {
    const moving = this.moving.size > 0 ? this.moving.bounds : undefined;
    const { bounds } = this.tree;
    return moving === undefined || bounds === undefined
      ? (moving ?? bounds)
      : unionBounds(bounds, moving);
  }

  /**
   * An object's indexed world box.
   *
   * @param id - The object id.
   * @returns Its box, or `undefined` when it is not indexed.
   */
  boundsOf(id: ObjectId): WorldBounds | undefined {
    return this.moving.has(id) ? this.moving.boundsOf(id) : this.tree.boundsOf(id);
  }

  /**
   * An object's indexed box without its drawing bounds (`setDrawingBounds`), cut by its clip
   * chain as its box is: what a frame covers without its name (layers).
   *
   * @param id - The object id.
   * @returns Its box, or `undefined` when it is not indexed or nothing of it is left.
   */
  boundsWithoutDrawingOf(id: ObjectId): WorldBounds | undefined {
    const drawing = this.drawing.get(id);
    if (drawing === undefined || this.moving.has(id)) return this.boundsOf(id);
    return drawing.base && this.clips.boxOf(id, drawing.base, undefined);
  }

  /**
   * Supplements geometry with the text pass's actual world-space drawing bounds, cut by the
   * object's clip chain like its own box (so a frame title is cut by the frame's clipping
   * ancestors, never by the frame itself).
   *
   * @param id - The object.
   * @param extra - Its drawing bounds, or undefined to remove the supplement.
   * @param isAsync - False during document collection: stage the supplement for `apply` to
   *   index together with the new geometry. True updates immediately and requests replanning.
   * @returns The indexed bounds before and after.
   */
  setDrawingBounds(id: ObjectId, extra: WorldBounds | undefined, isAsync = true): IndexedBoxChange {
    // Drawing bounds that are not finite (a label laid out from a value no command writes) are
    // no bounds: the tree's arithmetic must never see them.
    if (extra !== undefined && !isFiniteBounds(extra))
      return this.setDrawingBounds(id, undefined, isAsync);
    const moved = this.moving.setDrawing(id, extra);
    if (moved !== undefined) {
      // A moving text publishes its bounds where it is drawn now; the tree takes them at the end.
      const base = this.drawing.get(id)?.base;
      if (extra === undefined) this.drawing.delete(id);
      else this.drawing.set(id, { base, extra });
      return moved;
    }
    const previous = this.tree.boundsOf(id);
    const old = this.drawing.get(id);
    const base = old === undefined ? (this.clips.baseOf(id) ?? previous) : old.base;
    if (extra === undefined) this.drawing.delete(id);
    else this.drawing.set(id, { base, extra });
    const next = base === undefined ? undefined : this.clips.boxOf(id, base, extra);
    // A clipped-away object (indexed nowhere) may come into view by its drawing, and go again.
    if (isAsync && base !== undefined && !isSameBox(previous, next)) {
      if (next === undefined) this.tree.remove(id);
      else this.tree.update(id, next);
      this.clips.markAway(id, next === undefined);
      this.drawingChanges.note(id);
    }
    return { previous, next };
  }

  /**
   * Brings the index up to date with a document change: every listed object and every
   * descendant of one is re-indexed from the change set's view of the document (present:
   * indexed at its world box, unless it has none; absent: removed).
   *
   * @param changes - The change set; its objects are read, never mutated.
   * @returns Every re-indexed object id with its box before and after, so a culler can tell
   *   which objects entered, left or moved within its query region.
   */
  apply(changes: SceneChangeSet): ReadonlyMap<ObjectId, IndexedBoxChange> {
    const refreshed = new Map<ObjectId, IndexedBoxChange>();
    this.applyInto(changes, (id, previous, next) => refreshed.set(id, { previous, next }));
    return refreshed;
  }

  /**
   * Updates the complete index before reporting each changed box, in apply order.
   * Events hold independent bounds; an observer may query or update the index safely.
   *
   * @param changes - The change set; its objects are read, never mutated.
   * @param observe - Receives each id and its previous and next bounds after indexing.
   */
  applyInto(
    changes: SceneChangeSet,
    observe: (
      id: ObjectId,
      previous: WorldBounds | undefined,
      next: WorldBounds | undefined,
    ) => void,
  ): void {
    if (this.moving.isActive && isMovingListed(this.moving, changes)) this.endMoving();
    const batch = getRootMoveBatch(changes);
    const items =
      batch && this.canApplyRootBatch(batch, changes) ? batch : this.changedIds(changes);
    const events = [];
    const updates = [];
    let removed: ObjectId[] | undefined;
    let indexedRemovals = 0;
    const objects: (readonly [ObjectId, BoardObject | undefined])[] = [];
    for (const item of items) {
      const id = typeof item === 'string' ? item : item.id;
      const object = typeof item === 'string' ? changes.get(item) : item;
      objects.push([id, object]);
      this.clips.noteFrame(id, object);
    }
    // Clipping frames are all known now, whatever order the change set lists them in.
    this.clips.startApply();
    for (const [id, object] of objects) {
      const transform = object && worldTransformOf(object, changes);
      const box = object && transform && worldBoundsOf(object, transform);
      // A box that is not finite is no box: left out rather than poison the tree's area
      // arithmetic (the `DrawableGate` upstream holds the whole rule).
      const base = box && isFiniteBounds(box) ? box : undefined;
      const drawing = this.drawing.get(id);
      if (base === undefined || object === undefined || transform === undefined) {
        this.drawing.delete(id);
        this.clips.forget(id);
      } else {
        if (drawing !== undefined) drawing.base = base;
        this.clips.set(object, transform, base, changes);
      }
      const next = base && this.clips.boxOf(id, base, drawing?.extra);
      if (base !== undefined) this.clips.markAway(id, next === undefined);
      const previous = this.tree.boundsOf(id);
      if (next) {
        const event = { key: id, previous, bounds: next };
        events.push(event);
        updates.push(event);
      } else {
        events.push({ key: id, previous, bounds: undefined });
        (removed ??= []).push(id);
        if (previous !== undefined) indexedRemovals += 1;
      }
    }
    // A change that empties the tree (a page switch takes every object off) clears it
    // at once and packs what arrives, rather than removing and inserting one by one.
    if (indexedRemovals > 0 && indexedRemovals === this.tree.size) this.tree.clear();
    else if (removed) for (const id of removed) this.tree.remove(id);
    if (this.tree.size === 0) this.tree.bulkLoad(updates);
    else this.applyUpdates(updates);
    for (const { key, previous, bounds } of events) observe(key, previous, bounds);
  }

  /**
   * Updates a non-empty tree: a batch of new objects at least as large as the tree is packed with
   * the tree (`RTree.bulkLoad`), the rest updated in place.
   *
   * @param updates - The objects' new boxes.
   */
  private applyUpdates(updates: readonly { key: ObjectId; bounds: WorldBounds }[]): void {
    const added = updates.filter(({ key }) => this.tree.boundsOf(key) === undefined);
    if (added.length < this.tree.size) {
      this.tree.updateMany(updates);
      return;
    }
    const moved = updates.filter(({ key }) => this.tree.boundsOf(key) !== undefined);
    if (moved.length > 0) this.tree.updateMany(moved);
    this.tree.bulkLoad(added);
  }

  private canApplyRootBatch(objects: readonly BoardObject[], changes: SceneChangeSet): boolean {
    return (
      isRootMoveChanges(changes) &&
      changes.created.length === 0 &&
      changes.deleted.length === 0 &&
      objects.length === changes.updated.length &&
      objects.every(
        (object, index) =>
          object.id === changes.updated[index] &&
          object.parentId === null &&
          this.parents.parentOf(object.id) === null &&
          !this.parents.hasChildren(object.id),
      )
    );
  }

  private changedIds(changes: SceneChangeSet): Iterable<ObjectId> {
    const touched = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
    if (!isRootMoveChanges(changes))
      for (const id of touched) this.parents.set(id, changes.get(id)?.parentId);
    return this.parents.withDescendants(touched);
  }

  /**
   * Every indexed object whose world box meets a rectangle, edges included.
   *
   * @param rect - The query rectangle, world units.
   * @returns The ids, in no particular order.
   */
  searchRect(rect: WorldBounds): ObjectId[] {
    const ids = this.tree.searchRect(rect);
    return this.moving.size > 0 ? this.moving.searchRect(rect, ids) : ids;
  }

  /**
   * Every indexed object whose world box contains a point.
   *
   * @param point - The point, world units.
   * @returns The ids, in no particular order.
   */
  searchPoint(point: Point): ObjectId[] {
    const ids = this.tree.searchPoint(point);
    return this.moving.size > 0 ? this.moving.searchPoint(point, ids) : ids;
  }

  /**
   * Whether a retained move is placing an object: its box moves outside the tree,
   * so a plan must not rely on where it is.
   *
   * @param id - The object.
   * @returns True while its session lasts.
   */
  isMoving(id: ObjectId): boolean {
    return this.moving.has(id);
  }

  /**
   * Takes root leaves out of the tree for a retained move: from now on their boxes follow
   * {@link SceneSpatialIndex.moveMoving}, and change sets need not list them.
   *
   * @param ids - The moving root leaves, in placement order.
   * @param positions - Their positions now, `x, y` per object.
   */
  beginMoving(ids: readonly ObjectId[], positions: Float64Array): void {
    this.endMoving();
    this.moving.begin(
      ids,
      (id) => {
        const box = this.tree.boundsOf(id);
        if (box === undefined) return undefined;
        const drawing = this.drawing.get(id);
        this.tree.remove(id);
        return { box: drawing?.base ?? box, drawing: drawing?.extra };
      },
      positions,
    );
    this.drawingChanges.noteUnknown();
  }

  /**
   * Moves the moving root leaves: to positions, or all by one shared displacement
   * from where positions last put them, writing nothing per object.
   *
   * @param positions - Their positions now, `x, y` per object, or the displacement `[dx, dy]`.
   * @param query - A region whose membership the caller tracks, if any.
   * @returns The objects that entered or left `query`.
   */
  moveMoving(positions: Float64Array | readonly [number, number], query?: WorldBounds): ObjectId[] {
    if (positions instanceof Float64Array) return this.moving.move(positions, query);
    return this.moving.translate(positions[0], positions[1], query);
  }

  /** Puts the moving root leaves back in the tree, where they are now. */
  endMoving(): void {
    if (!this.moving.isActive) return;
    const updates = [...this.moving.entries()].map(([key, bounds]) => ({ key, bounds }));
    this.moving.end();
    // As `applyInto` fills an empty tree: packed, so it matches an index built from scratch.
    if (this.tree.size === 0) this.tree.bulkLoad(updates);
    else this.tree.updateMany(updates);
    this.drawingChanges.noteUnknown();
  }

  /**
   * Checks the R-tree's invariants, for tests and debugging.
   *
   * @returns One line per broken invariant; empty when sound.
   */
  validate(): string[] {
    return this.tree.validate();
  }
}
