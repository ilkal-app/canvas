// Test doubles for the document the scene mirrors: object builders with fixed, valid fields and
// an in-memory document that produces change sets the way the DocumentStore will.
import type {
  BaseObject,
  BoardObject,
  FrameObject,
  GroupObject,
  ObjectId,
  PrincipalId,
  ShapeObject,
} from '@canvas/schema';

import type { SceneChangeSet, SceneSource } from '../scene-source.js';

/** Overrides for a fixture object; `parentId` may be given as a plain string. */
type Overrides<T extends BoardObject> = Partial<Omit<T, 'id' | 'parentId'>> & {
  readonly parentId?: string | null;
};

function sharedFields(id: string, parentId: string | null | undefined): Omit<BaseObject, 'type'> {
  return {
    id: id as ObjectId,
    parentId: (parentId ?? null) as ObjectId | null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/**
 * A filled, unrotated 10 × 10 rectangle shape at the origin, with no stroke or label.
 *
 * @param id - The object id.
 * @param overrides - Fields to change.
 * @returns The shape.
 */
export function shapeObject(id: string, overrides: Overrides<ShapeObject> = {}): ShapeObject {
  const { parentId, ...fields } = overrides;
  return {
    ...sharedFields(id, parentId),
    type: 'shape',
    width: 10,
    height: 10,
    kind: 'rectangle',
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...fields,
  };
}

/**
 * A 100 × 100 frame at the origin with a white background.
 *
 * @param id - The object id.
 * @param overrides - Fields to change.
 * @returns The frame.
 */
export function frameObject(id: string, overrides: Overrides<FrameObject> = {}): FrameObject {
  const { parentId, ...fields } = overrides;
  return {
    ...sharedFields(id, parentId),
    type: 'frame',
    width: 100,
    height: 100,
    name: 'Frame',
    clip: false,
    background: [1, 1, 1, 1],
    ...fields,
  };
}

/**
 * A group at the origin.
 *
 * @param id - The object id.
 * @param overrides - Fields to change.
 * @returns The group.
 */
export function groupObject(id: string, overrides: Overrides<GroupObject> = {}): GroupObject {
  const { parentId, ...fields } = overrides;
  return { ...sharedFields(id, parentId), type: 'group', ...fields };
}

/**
 * A `z` key that sorts by index: `zKeyAt(i) < zKeyAt(j)` exactly when `i < j`, for i, j below
 * 10⁶. Boards built by appending get ascending keys; fixtures that share one key paint in id
 * order instead, which is not their slot order. A valid fractional-index key (the schema's
 * `isValidKey`): the integer `a0`, the padded index, and a final `V` so the fraction never ends
 * in `0`.
 *
 * @param index - The object's position in the stack, bottom first.
 * @returns The key.
 */
export function zKeyAt(index: number): string {
  return `a0${String(index).padStart(6, '0')}V`;
}

/**
 * A source over a fixed set of objects.
 *
 * @param objects - The objects.
 * @returns A source that reads them by id.
 */
export function sourceOf(objects: readonly BoardObject[]): SceneSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return { get: (id) => byId.get(id) };
}

/**
 * An in-memory document that records its changes and hands them out as a change set, like the
 * DocumentStore's change events. Objects are replaced, never mutated.
 */
export class FakeSceneDocument implements SceneSource {
  private readonly objects = new Map<ObjectId, BoardObject>();
  private created = new Set<ObjectId>();
  private updated = new Set<ObjectId>();
  private deleted = new Set<ObjectId>();

  /**
   * Reads an object.
   *
   * @param id - The object id.
   * @returns The object, if present.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.objects.get(id);
  }

  /**
   * Adds objects.
   *
   * @param objects - The new objects.
   */
  create(...objects: BoardObject[]): void {
    for (const object of objects) {
      this.objects.set(object.id, object);
      this.created.add(object.id);
    }
  }

  /**
   * Replaces an object with a changed copy.
   *
   * @param id - The object id.
   * @param fields - The fields to change.
   * @throws {RangeError} When the object does not exist.
   */
  update(id: string, fields: Partial<BoardObject>): void {
    const object = this.objects.get(id as ObjectId);
    if (!object) throw new RangeError(`No object "${id}".`);
    this.objects.set(object.id, { ...object, ...fields } as BoardObject);
    this.updated.add(object.id);
  }

  /**
   * Removes objects.
   *
   * @param ids - The ids to remove.
   */
  delete(...ids: string[]): void {
    for (const id of ids) {
      this.objects.delete(id as ObjectId);
      this.deleted.add(id as ObjectId);
    }
  }

  /**
   * Hands out the changes made since the last call.
   *
   * @returns The change set, reading the document as it is now.
   */
  takeChanges(): SceneChangeSet {
    const changes: SceneChangeSet = {
      created: [...this.created],
      updated: [...this.updated],
      deleted: [...this.deleted],
      get: (id) => this.objects.get(id),
    };
    this.created = new Set();
    this.updated = new Set();
    this.deleted = new Set();
    return changes;
  }
}
