import { isFarObject } from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { worldBoundsOfBox, type OrientedBox } from './oriented-box.js';
import { selectionBoxOf } from './selection-frame.js';
import { type SelectionSource } from './selection-geometry.js';
import {
  isChangeRelated,
  selectionRelationsOf,
  type SelectionRelations,
  type TouchedIds,
} from './selection-relations.js';

interface Entry {
  readonly isFar: boolean;
  readonly relations: SelectionRelations;
  geometry?: { readonly box: OrientedBox | undefined; readonly bounds: WorldBounds | undefined };
}

/**
 * Keeps the bound check for each selected object until that object's geometry can change.
 * Keeps oriented boxes and their world bounds under the same dependency rule. A related edit
 * rebuilds only the aggregate frame, without walking unchanged subtrees or recomputing every
 * corner. Entries are limited to the current selection and cleared after gestures.
 */
export class SelectionFarCache {
  private readonly entries = new Map<ObjectId, Entry>();

  /**
   * Creates an empty cache over the live document.
   *
   * @param source - The document after each reported change.
   */
  constructor(private readonly source: SelectionSource) {}

  /** Forgets every bound check, as when the selection or the geometry source changes. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Drops checks whose objects, ancestors or carried descendants changed, including arrivals.
   *
   * @param changes - The change set, after application to the document.
   */
  invalidate(changes: TouchedIds): void {
    const touched = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
    for (const [id, entry] of this.entries) {
      const isRelated = entry.relations.hasGroup
        ? isChangeRelated(changes, entry.relations, this.source)
        : intersects(touched, entry.relations.ids);
      if (isRelated) this.entries.delete(id);
    }
  }

  /**
   * Collects the selected far objects, computing only checks invalidated by a related edit.
   *
   * @param ids - The current selection.
   * @returns A new set, safe for a scope retained by a caller.
   */
  farAmong(ids: readonly ObjectId[]): ReadonlySet<ObjectId> {
    const far = new Set<ObjectId>();
    for (const id of ids) {
      const entry = this.entryOf(id);
      if (entry.isFar) far.add(id);
    }
    return far;
  }

  /**
   * Combines cached boxes with the same lone-near-object rule as `selectionFrameOf`.
   *
   * @param ids - The current selection.
   * @returns The oriented lone box or axis-aligned aggregate, if any has geometry.
   */
  frame(ids: readonly ObjectId[]): OrientedBox | undefined {
    let nearCount = 0;
    let boxCount = 0;
    let only: OrientedBox | undefined;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const entry = this.entryOf(id);
      if (entry.isFar) continue;
      nearCount += 1;
      if (entry.geometry === undefined) {
        const box = selectionBoxOf(id, this.source);
        entry.geometry = { box, bounds: box === undefined ? undefined : worldBoundsOfBox(box) };
      }
      const { box, bounds } = entry.geometry;
      if (box === undefined || bounds === undefined) continue;
      boxCount += 1;
      only = box;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
    if (ids.length === 1 || (nearCount < ids.length && boxCount === 1)) return only;
    if (minX > maxX) return undefined;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
  }

  private entryOf(id: ObjectId): Entry {
    let entry = this.entries.get(id);
    if (entry === undefined) {
      entry = {
        isFar: isFarObject(this.source, id),
        relations: selectionRelationsOf([id], this.source),
      };
      this.entries.set(id, entry);
    }
    return entry;
  }
}

/**
 * Checks the smaller set so dense changes stay linear for leaves with few dependencies.
 *
 * @param left - Touched ids or cached dependencies.
 * @param right - The other set.
 * @returns Whether any id belongs to both sets.
 */
function intersects(left: ReadonlySet<ObjectId>, right: ReadonlySet<ObjectId>): boolean {
  if (left.size > right.size) return intersects(right, left);
  for (const id of left) if (right.has(id)) return true;
  return false;
}
