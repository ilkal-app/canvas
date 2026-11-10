import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import type { SceneChangeSet } from '../scene/scene-source.js';

import { changeSetObjects } from './change-set-objects.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

/**
 * Finds an exact local translation when every other field is unchanged. Nested immutable
 * document values retain their identity; replaced values conservatively use the full object.
 *
 * @param before - Last object sent to the mirror.
 * @param after - Current object.
 * @param shared - The displacement already selected for this message, if any.
 * @returns An exactly reconstructible displacement, otherwise undefined.
 */
function displacement(
  before: BoardObject | undefined,
  after: BoardObject,
  shared: Point | undefined,
): Point | undefined {
  if (before === undefined) return undefined;
  const x = after.x - before.x;
  const y = after.y - before.y;
  if (before.x + x !== after.x || before.y + y !== after.y) return undefined;
  if (shared !== undefined && (shared.x !== x || shared.y !== y)) return undefined;
  const keys = Object.keys(after) as (keyof BoardObject)[];
  if (keys.length !== Object.keys(before).length) return undefined;
  if (
    keys.some(
      (key) =>
        key !== 'x' && key !== 'y' && (before[key] !== after[key] || !Object.hasOwn(before, key)),
    )
  )
    return undefined;
  return shared ?? { x, y };
}

/**
 * Encodes frame changes against the last state sent to one host. Objects sharing a pure local
 * translation are sent as ids plus one displacement, rather than thousands of full objects.
 * Other changes retain the normal full-object format, including concurrently replaced values.
 * Ordered delivery is required, as for the host's ordinary change sets; use one encoder per host.
 */
export class TranslationChangeEncoder {
  private readonly sent = new Map<ObjectId, BoardObject>();

  /** Releases remembered scene values on host disposal. */
  clear(): void {
    this.sent.clear();
  }

  /**
   * Encodes and remembers the latest source values, without mutating source objects.
   *
   * @param changes - Coalesced changes for this frame.
   * @returns Full changed objects plus a shared translation where possible.
   */
  encode(changes: SceneChangeSet): SerializableChangeSet {
    const objects = changeSetObjects(changes);
    const ids: ObjectId[] = [];
    let delta: Point | undefined;
    for (const id of new Set(changes.updated)) {
      const object = objects.get(id);
      if (object === undefined) continue;
      const by = displacement(this.sent.get(id), object, delta);
      if (by === undefined) continue;
      delta ??= by;
      ids.push(id);
    }
    for (const listed of [changes.created, changes.updated, changes.deleted]) {
      for (const id of listed) if (!objects.has(id)) this.sent.delete(id);
    }
    for (const [id, object] of objects) this.sent.set(id, object);
    for (const id of ids) objects.delete(id);
    const full = {
      created: [...changes.created],
      updated: [...changes.updated],
      deleted: [...changes.deleted],
      objects: Object.fromEntries(objects),
    };
    return delta === undefined ? full : { ...full, translation: { ids, ...delta } };
  }
}
