import type { BoardObject, ObjectId } from '@canvas/schema';

import { ROOT_MOVE_INTERIOR } from '../drawable/root-move-envelope.js';
import { worldBoundsOf } from '../spatial/object-world-bounds.js';

import type { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneObject } from './scene-pass.js';
import type { SceneSource } from './scene-source.js';
import { worldTransformOf, type WorldTransform } from './world-transform.js';

/**
 * The extent within which a translating move is placed through the move shaders' offset,
 * world units. The shaders add a float32 translation to a float32 placement; with
 * every member's start, the translation and every member's end within this extent, each of those
 * roundings is at most half a float32 step here (1/16 of a world unit), so the sum is within
 * 3/16 of a world unit of rounding the double sum once, as positions are: the precision float32
 * world coordinates already have this far out. Any other translation is placed as positions.
 */
const PRECISE_TRANSLATION_EXTENT = 2 ** 20;

/**
 * An object's transform with its root's position left out: `worldTransformOf`'s
 * arithmetic, step for step, except that the last step, the root's, does not add the root's
 * `x` and `y`. Adding them to this gives `worldTransformOf`'s result bit for bit, so a moved
 * root places its descendants exactly where full preparation would.
 *
 * @param object - A descendant of a root, or a root (whose offset is zero).
 * @param source - Its ancestors.
 * @returns Its world turn, and its offset from its root's position.
 */
export function rootOffsetOf(object: BoardObject, source: SceneSource): WorldTransform {
  let cos = Math.cos(object.rotation);
  let sin = Math.sin(object.rotation);
  if (object.parentId === null) return { cos, sin, x: 0, y: 0 };
  let x = object.x;
  let y = object.y;
  let parent = source.get(object.parentId);
  const visited = new Set<ObjectId>([object.id]);
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    const parentCos = Math.cos(parent.rotation);
    const parentSin = Math.sin(parent.rotation);
    [cos, sin] = [parentCos * cos - parentSin * sin, parentSin * cos + parentCos * sin];
    [x, y] =
      parent.parentId === null
        ? [parentCos * x - parentSin * y, parentSin * x + parentCos * y]
        : [parentCos * x - parentSin * y + parent.x, parentSin * x + parentCos * y + parent.y];
    parent = parent.parentId === null ? undefined : source.get(parent.parentId);
  }
  return { cos, sin, x, y };
}

/** What a session's members must not hold, beyond the passes' own contract. */
export interface RetainedMemberChecks {
  /** Whether a connector outside the members is attached to any of them. */
  hasConnectorsOutside(members: ReadonlySet<ObjectId>): boolean;
  /** Whether any member is a layer. */
  hasLayerAmong(ids: readonly ObjectId[]): boolean;
}

/** A member's palettes, as the scene gave them when the session started. */
type MemberPalettes = Pick<SceneObject, 'palette' | 'textPalette'>;

/**
 * Every object a retained session places: its roots, in placement order, then each
 * root's descendants. A placement of the roots places every member: a root at its position, a
 * descendant at its offset from its root (`rootOffsetOf`) plus its root's position. Roots are the
 * session's own copies, moved in place, so passes holding them as targets see them where drawn.
 */
export class RetainedMembers {
  /** Every member, roots first. */
  readonly ids: readonly ObjectId[];
  private readonly objects: readonly BoardObject[];
  private readonly rootOf: Int32Array;
  private readonly offsets: Float64Array;
  private readonly palettes: readonly MemberPalettes[];
  private readonly reach: Float64Array;
  private readonly at: Float64Array;
  /** The positions `allowed` was worked out from, and the translations they allow. */
  private allowedFrom: Float64Array | undefined;
  private allowed: readonly [number, number, number, number] | undefined;

  private constructor(
    ids: readonly ObjectId[],
    objects: readonly BoardObject[],
    rootOf: Int32Array,
    offsets: Float64Array,
    palettes: readonly MemberPalettes[],
    reach: Float64Array,
  ) {
    this.ids = ids;
    this.objects = objects;
    this.rootOf = rootOf;
    this.offsets = offsets;
    this.palettes = palettes;
    this.reach = reach;
    this.at = new Float64Array(ids.length * 2);
  }

  /**
   * Expands roots into members, or refuses: a member missing from the source, a clipping frame,
   * a component main or instance, a connector with an end outside the members, a connector
   * outside attached to a member, or a layer.
   *
   * @param roots - The session's roots.
   * @param hierarchy - The scene's parents and children.
   * @param source - Every member's object now.
   * @param checks - Connector and layer checks.
   * @param current - Gives a target its current palette.
   * @returns The members, or undefined when the session cannot bypass change sets.
   */
  static expand(
    roots: readonly ObjectId[],
    hierarchy: SceneHierarchy,
    source: SceneSource,
    checks: RetainedMemberChecks,
    current: (target: SceneObject) => SceneObject,
  ): RetainedMembers | undefined {
    const ids = [...roots];
    const rootIndex: number[] = roots.map((root, index) => index);
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (id === undefined) continue;
      for (const child of hierarchy.childrenOf(id)) {
        ids.push(child);
        rootIndex.push(rootIndex[index] ?? 0);
      }
    }
    const members = new Set(ids);
    if (members.size !== ids.length) return undefined;
    const objects: BoardObject[] = [];
    for (const id of ids) {
      const object = source.get(id);
      if (!object || !isMovable(object, members)) return undefined;
      objects.push(object);
    }
    if (checks.hasConnectorsOutside(members) || checks.hasLayerAmong(ids)) return undefined;
    const offsets = new Float64Array(ids.length * 4);
    const reach = new Float64Array(roots.length);
    const palettes = objects.map((object, index) => {
      const offset = rootOffsetOf(object, source);
      offsets.set([offset.cos, offset.sin, offset.x, offset.y], index * 4);
      const transform = worldTransformOf(object, source);
      const root = rootIndex[index] ?? 0;
      reach[root] = Math.max(reach[root] ?? 0, reachOf(object, transform, objects[root]));
      const { palette, textPalette } = current({ object, transform });
      return { ...(palette && { palette }), ...(textPalette && { textPalette }) };
    });
    // The roots are the session's own copies, moved in place.
    for (let index = 0; index < roots.length; index += 1) {
      const object = objects[index];
      if (object) objects[index] = { ...object };
    }
    return new RetainedMembers(ids, objects, Int32Array.from(rootIndex), offsets, palettes, reach);
  }

  /**
   * Whether every root, placed at these positions, keeps its whole subtree within the interior
   * the drawable gate's root-move envelope keeps leaves within.
   *
   * @param positions - The roots' positions, `x, y` per root.
   * @returns True when the placement is drawable.
   */
  accepts(positions: Float64Array): boolean {
    const { reach } = this;
    if (positions.length !== reach.length * 2) return false;
    for (let root = 0; root < reach.length; root += 1) {
      const limit = ROOT_MOVE_INTERIOR - (reach[root] ?? 0);
      const x = positions[root * 2] ?? Number.NaN;
      const y = positions[root * 2 + 1] ?? Number.NaN;
      if (!(Math.abs(x) <= limit && Math.abs(y) <= limit)) return false;
    }
    return true;
  }

  /**
   * Whether every root, at these positions moved by one translation, keeps its subtree within
   * the interior (`accepts`). The translations each position array allows are worked
   * out once, so a translating drag checks two intervals a frame.
   *
   * @param positions - The roots' positions the translation is from, `x, y` per root.
   * @param delta - The translation, `[dx, dy]`.
   * @returns True when the placement is drawable.
   */
  acceptsDelta(positions: Float64Array, delta: readonly [number, number]): boolean {
    if (this.allowedFrom !== positions) {
      this.allowedFrom = positions;
      this.allowed = this.allowedTranslations(positions);
    }
    const allowed = this.allowed;
    const [dx, dy] = delta;
    return (
      allowed !== undefined &&
      dx >= allowed[0] &&
      dx <= allowed[1] &&
      dy >= allowed[2] &&
      dy <= allowed[3]
    );
  }

  /**
   * Places every member for the roots' positions.
   *
   * @param positions - The roots' positions, `x, y` per root.
   * @param visit - Receives each member's target, roots first.
   * @returns Every member's position, `x, y` per member (borrowed until the next call).
   */
  place(positions: Float64Array, visit: (target: SceneObject) => void): Float64Array {
    const { objects, rootOf, at } = this;
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      if (object === undefined) continue;
      const root = rootOf[index] ?? 0;
      const rootX = positions[root * 2] ?? 0;
      const target = this.targetAt(index, object, rootX, positions[root * 2 + 1] ?? 0);
      if (root === index) {
        const writable = object as { x: number; y: number };
        writable.x = target.transform.x;
        writable.y = target.transform.y;
      }
      at[index * 2] = target.transform.x;
      at[index * 2 + 1] = target.transform.y;
      visit(target);
    }
    return at;
  }

  /**
   * Places some members where a translation of the roots' positions puts them, in
   * the same arithmetic as `place` gives positions that are the translated ones.
   *
   * @param indices - The members, by index in `ids`.
   * @param positions - The roots' positions the translation is from, `x, y` per root.
   * @param delta - The translation, `[dx, dy]`.
   * @param visit - Receives each listed member's target.
   */
  placeEach(
    indices: readonly number[],
    positions: Float64Array,
    delta: readonly [number, number],
    visit: (target: SceneObject) => void,
  ): void {
    for (const index of indices) {
      const root = this.rootOf[index] ?? 0;
      const rootX = (positions[root * 2] ?? 0) + delta[0];
      const rootY = (positions[root * 2 + 1] ?? 0) + delta[1];
      const object = this.objects[index];
      if (object !== undefined) visit(this.targetAt(index, object, rootX, rootY));
    }
  }

  private targetAt(index: number, object: BoardObject, rootX: number, rootY: number): SceneObject {
    const { rootOf, offsets, palettes } = this;
    const isRoot = (rootOf[index] ?? 0) === index;
    const x = isRoot ? rootX : (offsets[index * 4 + 2] ?? 0) + rootX;
    const y = isRoot ? rootY : (offsets[index * 4 + 3] ?? 0) + rootY;
    const transform = { cos: offsets[index * 4] ?? 1, sin: offsets[index * 4 + 1] ?? 0, x, y };
    return { object, transform, ...palettes[index] };
  }

  /**
   * The translations every root at these positions may take and stay within the interior.
   *
   * @param positions - The roots' positions, `x, y` per root.
   * @returns The allowed `dx` range then `dy` range, or undefined when none is.
   */
  private allowedTranslations(
    positions: Float64Array,
  ): readonly [number, number, number, number] | undefined {
    const { reach } = this;
    if (positions.length !== reach.length * 2) return undefined;
    // The translation itself within the precise extent, as each member's start and end are.
    let minX = -PRECISE_TRANSLATION_EXTENT;
    let maxX = PRECISE_TRANSLATION_EXTENT;
    let minY = -PRECISE_TRANSLATION_EXTENT;
    let maxY = PRECISE_TRANSLATION_EXTENT;
    for (let root = 0; root < reach.length; root += 1) {
      // Within the precise extent too: the move shaders add the translation in float32.
      const limit = Math.min(ROOT_MOVE_INTERIOR, PRECISE_TRANSLATION_EXTENT) - (reach[root] ?? 0);
      const x = positions[root * 2] ?? Number.NaN;
      const y = positions[root * 2 + 1] ?? Number.NaN;
      if (!(Math.abs(x) <= limit && Math.abs(y) <= limit)) return undefined;
      minX = Math.max(minX, -limit - x);
      maxX = Math.min(maxX, limit - x);
      minY = Math.max(minY, -limit - y);
      maxY = Math.min(maxY, limit - y);
    }
    return minX <= maxX && minY <= maxY ? [minX, maxX, minY, maxY] : undefined;
  }
}

/**
 * Whether a member moves with its root as is: not a clipping frame (its clip moves with it), a
 * component main or instance (its content is expanded), a connector with an end outside, or a
 * translucent group or frame (a layer).
 *
 * @param object - The member.
 * @param members - Every member.
 * @returns True when it may.
 */
function isMovable(object: BoardObject, members: ReadonlySet<ObjectId>): boolean {
  // A translucent group or frame is a layer, drawn through its composite.
  if ((object.type === 'group' || object.type === 'frame') && (object.opacity ?? 1) < 1)
    return false;
  switch (object.type) {
    case 'frame':
      return !object.clip;
    case 'component':
    case 'instance':
      return false;
    case 'connector':
      return [object.from, object.to].every(
        (end) => end.kind !== 'object' || members.has(end.objectId),
      );
    default:
      return true;
  }
}

/**
 * How far a member reaches from its root's position, on either axis: its origin, which the
 * drawable gate judges for every object (a boxless group too), and its box.
 *
 * @param object - The member.
 * @param transform - Its world transform.
 * @param root - Its root.
 * @returns The reach, world units.
 */
function reachOf(object: BoardObject, transform: WorldTransform, root: BoardObject | undefined) {
  if (root === undefined) return 0;
  const origin = Math.max(Math.abs(transform.x - root.x), Math.abs(transform.y - root.y));
  const box = worldBoundsOf(object, transform);
  if (box === undefined) return origin;
  return Math.max(
    origin,
    Math.abs(box.minX - root.x),
    Math.abs(box.maxX - root.x),
    Math.abs(box.minY - root.y),
    Math.abs(box.maxY - root.y),
  );
}
