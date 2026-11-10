import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SceneChangeSet } from '../scene/scene-source.js';

import { changeSetObjects } from './change-set-objects.js';
import { isRetainedMoveCommand, type RetainedMoveCommand } from './retained-move-command.js';

/**
 * A {@link SceneChangeSet} as plain data, so it can be posted to the engine worker: a change
 * set's `get` is a closure over the main thread's document and cannot be structured-cloned. It
 * carries the same id lists and, in `objects`, every listed object the document still holds
 * plus any ancestor of one, since a world transform composes its ancestors. An
 * id listed but absent from `objects` is gone from the document.
 */
export interface SerializableChangeSet {
  /** Ordered transient placement; ordinary lists must be empty when present. */
  readonly retainedMove?: RetainedMoveCommand;
  /** Exact local displacement from the preceding mirror state; full objects override it. */
  readonly translation?: {
    /** Objects translated together. */
    readonly ids: readonly ObjectId[];
    /** Horizontal displacement in local document units. */
    readonly x: number;
    /** Vertical displacement in local document units. */
    readonly y: number;
  };
  /** Objects added to the document. */
  readonly created: readonly ObjectId[];
  /** Objects whose fields changed. */
  readonly updated: readonly ObjectId[];
  /** Objects removed from the document. */
  readonly deleted: readonly ObjectId[];
  /**
   * The document's current state of every listed id it still holds, and of their ancestors,
   * keyed by id. Read keys with `Object.hasOwn`: an id is a plain own key, even `__proto__`.
   */
  readonly objects: Readonly<Record<string, BoardObject>>;
}

/**
 * Turns a document change set into plain data for the engine worker: the id lists copied, and
 * each listed object the document still holds, with its ancestors, read through `changes.get`.
 * Main thread; pure (the change set and its objects are read, never mutated).
 *
 * @param changes - The change set, as the document produced it.
 * @returns The serialisable change set.
 */
export function serializeChangeSet(changes: SceneChangeSet): SerializableChangeSet {
  const found = changeSetObjects(changes);
  return {
    created: [...changes.created],
    updated: [...changes.updated],
    deleted: [...changes.deleted],
    // fromEntries defines own properties, so an id such as `__proto__` stays a plain key.
    objects: Object.fromEntries(found),
  };
}

function isIdList(value: unknown): boolean {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

/**
 * Checks a change set received from another thread: three lists of string ids and an object
 * map. Board objects are the document's, validated there, and are not re-checked. The engine
 * runtime runs it inside the frame's `applyChanges` stage, so its cost is timed with the rest of
 * the change's work.
 *
 * @param value - The received change set.
 * @returns `true` when it has the shape of a {@link SerializableChangeSet}.
 */
export function isSerializableChangeSet(value: unknown): value is SerializableChangeSet {
  if (typeof value !== 'object' || value === null) return false;
  const { created, updated, deleted, objects, translation, retainedMove } = value as Record<
    string,
    unknown
  >;
  return (
    (retainedMove === undefined ||
      (isRetainedMoveCommand(retainedMove) &&
        Array.isArray(created) &&
        created.length === 0 &&
        Array.isArray(updated) &&
        updated.length === 0 &&
        Array.isArray(deleted) &&
        deleted.length === 0 &&
        typeof objects === 'object' &&
        objects !== null &&
        Object.keys(objects).length === 0 &&
        translation === undefined)) &&
    isTranslation(translation) &&
    isIdList(created) &&
    isIdList(updated) &&
    isIdList(deleted) &&
    typeof objects === 'object' &&
    objects !== null
  );
}

/**
 * Checks the optional compact translation command before the runtime consumes it.
 *
 * @param value - Received translation.
 * @returns Whether the value is absent or a finite displacement with string ids.
 */
function isTranslation(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null) return false;
  const { ids, x, y } = value as Record<string, unknown>;
  return (
    isIdList(ids) &&
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y)
  );
}
