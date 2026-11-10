import type { BoardObject, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { getRootMoveBatch } from '../scene/root-move-batch.js';
import { isRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { drawnLocalBounds, isDrawnPath, isSameDrawnMesh, type DrawnPath } from './drawn-path.js';
import { pathLayersOf, type PathLayer } from './path-layers.js';

/** A path or line the path pass draws, with what its meshes are keyed by. */
export interface TrackedPath {
  /** The object id. */
  readonly id: ObjectId;
  /** The object as last seen. */
  readonly object: DrawnPath;
  /**
   * Its mesh version: kept while the network (a line's points, route and caps), stroke width,
   * stroke style and fill flag stay the same (a move, a recolour), bumped when any of them changes.
   */
  readonly version: number;
  /** Its layers, one record each, in record order. */
  readonly layers: readonly PathLayer[];
  /** A box its drawing stays inside, in its own frame, for skipping off-screen records. */
  readonly localBounds: WorldBounds;
  /** Its records' slots in the pass's instance buffer, record 0 first. */
  readonly slots: readonly number[];
}

/** The path and layer a record of the pass belongs to. */
export interface PathRecordOwner {
  /** The path. */
  readonly path: TrackedPath;
  /** The record's layer. */
  readonly layer: PathLayer;
}

/** What the registry needs of the scene: an object's slots in a pass. */
export interface SlotLookup {
  /**
   * The slots an object's records occupy in one pass's buffer.
   *
   * @param id - The object.
   * @param passName - The pass.
   * @returns The slots, record 0 first.
   */
  slotsOf(id: ObjectId, passName: string): readonly number[];
  /** Up when compaction re-slots records without a change set (`Scene.compactionRevision`). */
  readonly compactionRevision?: number;
}

/**
 * The path pass's view of the document: every path and line it draws, its mesh version, and
 * which one and layer each of the pass's records belongs to. Fed every change set after the scene has
 * applied it. One per path drawer; rendering thread only.
 */
export class PathRegistry {
  private readonly passName: string;
  private readonly onRemoved: (id: ObjectId) => void;
  private readonly layersOf: (object: BoardObject) => readonly PathLayer[];
  private readonly paths = new Map<ObjectId, TrackedPath>();
  private readonly ownerBySlot = new Map<number, PathRecordOwner>();
  private versionCount = 0;
  /** The scene last observed, and its compaction revision the slots were read at. */
  private scene: SlotLookup | undefined;
  private compaction: number | undefined;

  /**
   * Creates an empty registry.
   *
   * @param passName - The path pass's name, to read its slots.
   * @param onRemoved - Called with each path that stops being drawn (deleted, or no longer a
   *   path that draws anything), so its meshes can go.
   * @param layersOf - The layers the pass draws of an object (its share of `pathLayersOf`: the
   *   path pass's paths and lines, or the connector pass's connectors); `pathLayersOf` if absent.
   */
  constructor(
    passName: string,
    onRemoved: (id: ObjectId) => void,
    layersOf: (object: BoardObject) => readonly PathLayer[] = pathLayersOf,
  ) {
    this.passName = passName;
    this.onRemoved = onRemoved;
    this.layersOf = layersOf;
  }

  /**
   * How many paths are drawn.
   *
   * @returns The count.
   */
  get size(): number {
    return this.paths.size;
  }

  /**
   * A tracked path.
   *
   * @param id - The object id.
   * @returns The path, or `undefined` when the pass does not draw it.
   */
  get(id: ObjectId): TrackedPath | undefined {
    this.followCompaction();
    return this.paths.get(id);
  }

  /**
   * The path and layer a record of the pass belongs to.
   *
   * @param slot - The record's slot.
   * @returns Its owner, or `undefined` for a free slot.
   */
  ownerOf(slot: number): PathRecordOwner | undefined {
    this.followCompaction();
    return this.ownerBySlot.get(slot);
  }

  /**
   * Brings the registry up to date with a change set the scene has just applied.
   *
   * @param changes - The change set.
   * @param scene - The scene, for the paths' slots.
   */
  observe(changes: SceneChangeSet, scene: SlotLookup): void {
    if (scene !== this.scene) {
      this.scene = scene;
      this.compaction = scene.compactionRevision;
    }
    this.followCompaction();
    const batch = getRootMoveBatch(changes);
    if (
      batch &&
      isRootMoveChanges(changes) &&
      changes.created.length === 0 &&
      changes.deleted.length === 0 &&
      batch.length === changes.updated.length &&
      batch.every(
        (object, index) => object.id === changes.updated[index] && object.parentId === null,
      )
    ) {
      for (let index = 0; index < batch.length; index += 1) {
        const object = batch[index];
        if (object && this.refreshRootMove(object, scene)) continue;
        // A fallback can invoke removal hooks; subsequent reads must remain live.
        for (const id of changes.updated.slice(index)) this.refresh(id, changes.get(id), scene);
        break;
      }
      return;
    }
    for (const ids of [changes.created, changes.updated, changes.deleted]) {
      for (const id of ids) this.refresh(id, changes.get(id), scene);
    }
  }

  /**
   * Reads every path's slots again once the scene's compaction moved records: slot
   * compaction re-slots records without a change set, so the slot owners would otherwise name
   * the records' old slots.
   */
  private followCompaction(): void {
    const { scene } = this;
    const revision = scene?.compactionRevision;
    if (!scene || revision === this.compaction) return;
    this.compaction = revision;
    this.ownerBySlot.clear();
    for (const [id, path] of this.paths) {
      const moved: TrackedPath = { ...path, slots: [...scene.slotsOf(id, this.passName)] };
      this.paths.set(id, moved);
      moved.slots.forEach((slot, index) => {
        const layer = moved.layers[index];
        if (layer) this.ownerBySlot.set(slot, { path: moved, layer });
      });
    }
  }

  private refreshRootMove(object: BoardObject, scene: SlotLookup): boolean {
    const previous = this.paths.get(object.id);
    if (!isDrawnPath(object)) {
      return previous === undefined;
    }
    // A connector's route in its own frame depends on where it is: always measured again.
    if (object.type === 'connector') return false;
    const slots = scene.slotsOf(object.id, this.passName);
    if (
      previous?.object.type !== object.type ||
      slots.length !== previous.slots.length ||
      !slots.every((slot, index) => slot === previous.slots[index])
    ) {
      return false;
    }
    const path: TrackedPath = {
      id: previous.id,
      object,
      version: previous.version,
      layers: previous.layers,
      localBounds: previous.localBounds,
      slots: previous.slots,
    };
    this.paths.set(object.id, path);
    slots.forEach((slot, index) => {
      const layer = path.layers[index];
      if (layer) this.ownerBySlot.set(slot, { path, layer });
    });
    return true;
  }

  private refresh(id: ObjectId, object: ReturnType<SceneChangeSet['get']>, scene: SlotLookup) {
    const previous = this.paths.get(id);
    // A slot this path let go may already belong to a path refreshed earlier in the change set.
    for (const slot of previous?.slots ?? []) {
      if (this.ownerBySlot.get(slot)?.path.id === id) this.ownerBySlot.delete(slot);
    }
    const layers = object ? this.layersOf(object) : [];
    if (!isDrawnPath(object) || layers.length === 0) {
      if (previous) {
        this.paths.delete(id);
        this.onRemoved(id);
      }
      return;
    }
    const isSame = previous !== undefined && isSameDrawnMesh(previous.object, object);
    if (!isSame) this.versionCount += 1;
    // A copy: the scene reuses its own list as the object's records change.
    const slots = [...scene.slotsOf(id, this.passName)];
    const path: TrackedPath = {
      id,
      object,
      version: isSame ? previous.version : this.versionCount,
      layers,
      localBounds: isSame ? previous.localBounds : drawnLocalBounds(object),
      slots,
    };
    this.paths.set(id, path);
    slots.forEach((slot, index) => {
      const layer = layers[index];
      if (layer) this.ownerBySlot.set(slot, { path, layer });
    });
  }
}

/**
 * A box in an object's own frame, placed in the world by its transform: the axis-aligned box
 * of the rotated box.
 *
 * @param local - The box in the object's frame.
 * @param cos - Cosine of the object's world rotation.
 * @param sin - Sine of it.
 * @param x - World x of the object's origin.
 * @param y - World y of it.
 * @returns The world box.
 */
export function placedBounds(
  local: WorldBounds,
  cos: number,
  sin: number,
  x: number,
  y: number,
): WorldBounds {
  const halfWidth = (local.maxX - local.minX) / 2;
  const halfHeight = (local.maxY - local.minY) / 2;
  const centreX = local.minX + halfWidth;
  const centreY = local.minY + halfHeight;
  const worldX = x + cos * centreX - sin * centreY;
  const worldY = y + sin * centreX + cos * centreY;
  const reachX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight;
  const reachY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight;
  return {
    minX: worldX - reachX,
    minY: worldY - reachY,
    maxX: worldX + reachX,
    maxY: worldY + reachY,
  };
}
