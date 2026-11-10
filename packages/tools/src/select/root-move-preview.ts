import {
  applyTransform,
  invertTransform,
  type BoardObject,
  type ObjectId,
  type Point,
  type RigidTransform,
} from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

const ROOT: RigidTransform = { cos: 1, sin: 0, x: 0, y: 0 };
const TO_ROOT = invertTransform(ROOT);

/**
 * One root move snapshot: root leaves, groups and non-clipping frames, whose subtrees stay in the
 * source. Membership and document geometry survive pointer updates;
 * positions are absolute doubles, and ordinary objects are materialized only on demand.
 * This is a preview, never a document command or a proof that a renderer supports a pass.
 */
export class RootMovePreview {
  private readonly materialized = new Map<ObjectId, BoardObject>();

  private constructor(
    /** Stable ordered membership for this move. */
    readonly ids: readonly ObjectId[],
    /** Stable document objects before the move. */
    readonly objects: readonly BoardObject[],
    /** Interleaved absolute local x/y, with an independently owned array per snapshot. */
    readonly positions: Float64Array,
    private readonly indices: ReadonlyMap<ObjectId, number>,
  ) {}

  /**
   * Checks all membership before creating a retained preview; unsupported cases use ordinary
   * previewObjects instead. Containers and even malformed leaves with children are excluded.
   *
   * @param ids - The move plan's movable ids.
   * @param source - The current document, without the preview.
   * @returns A base snapshot, or undefined if any member is ineligible.
   */
  static create(ids: readonly ObjectId[], source: SelectionSource): RootMovePreview | undefined {
    if (ids.length === 0) return undefined;
    const objects: BoardObject[] = [];
    const indices = new Map<ObjectId, number>();
    const positions = new Float64Array(ids.length * 2);
    for (const id of ids) {
      const object = source.get(id);
      if (object?.parentId !== null || indices.has(id) || !isRetainedRoot(object)) return undefined;
      // A group or frame carries its subtree, which stays in the source.
      const isContainer = object.type === 'group' || object.type === 'frame';
      if (!isContainer && !source.childrenOf(id)[Symbol.iterator]().next().done) return undefined;
      const index = objects.length;
      indices.set(id, index);
      objects.push(object);
      positions[index * 2] = object.x;
      positions[index * 2 + 1] = object.y;
    }
    return new RootMovePreview([...ids], objects, positions, indices);
  }

  /**
   * Uses exactly the ordinary preview's parent/inverse arithmetic, including signed zero.
   * Every update starts from document geometry, avoiding accumulated rounding and drift.
   *
   * @param delta - The snapped displacement from gesture start.
   * @returns A new snapshot sharing only immutable membership and geometry.
   */
  move(delta: Point): RootMovePreview {
    const positions = new Float64Array(this.positions.length);
    for (let index = 0; index < this.objects.length; index++) {
      const object = this.objects[index];
      if (object === undefined) continue;
      const origin = applyTransform(ROOT, { x: object.x, y: object.y });
      const position = applyTransform(TO_ROOT, {
        x: origin.x + delta.x,
        y: origin.y + delta.y,
      });
      positions[index * 2] = position.x;
      positions[index * 2 + 1] = position.y;
    }
    return new RootMovePreview(this.ids, this.objects, positions, this.indices);
  }

  /**
   * Returns to the unchanged document positions without applying identity arithmetic.
   *
   * @returns An independent snapshot preserving original signed zeros and membership.
   */
  rest(): RootMovePreview {
    const positions = new Float64Array(this.positions.length);
    for (const [index, object] of this.objects.entries()) {
      positions[index * 2] = object.x;
      positions[index * 2 + 1] = object.y;
    }
    return new RootMovePreview(this.ids, this.objects, positions, this.indices);
  }

  /**
   * Materializes a single ordinary object for overlays, hit tests or the fallback renderer.
   *
   * @param id - The requested member.
   * @returns Its previewed object, or undefined outside this move.
   */
  get(id: ObjectId): BoardObject | undefined {
    const index = this.indices.get(id);
    if (index === undefined) return undefined;
    const base = this.objects[index];
    const x = this.positions[index * 2];
    const y = this.positions[index * 2 + 1];
    if (base === undefined || x === undefined || y === undefined) return undefined;
    let object = this.materialized.get(id);
    if (!object) {
      object = {
        ...base,
        x,
        y,
      };
      this.materialized.set(id, object);
    }
    return object;
  }
}

/**
 * Whether an object can root a retained move: anything but a clipping frame (whose clip moves
 * with it) and a component main or instance (whose content is expanded), which preview by
 * `previewObjects`.
 *
 * @param object - A root object.
 * @returns True when it can.
 */
function isRetainedRoot(object: BoardObject): boolean {
  if (object.type === 'frame') return !object.clip;
  return object.type !== 'component' && object.type !== 'instance';
}
