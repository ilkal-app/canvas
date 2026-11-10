import type { BoardObject, ObjectId } from '@canvas/schema';

/**
 * Read access to the document the scene mirrors. The engine does not
 * import `@canvas/document`; the app adapts the `DocumentStore` to this interface, and
 * tests use a map.
 */
export interface SceneSource {
  /**
   * Reads an object as the document holds it now.
   *
   * @param id - The object id.
   * @returns The object, or `undefined` when the document has none with that id.
   */
  get(id: ObjectId): BoardObject | undefined;
}

/**
 * What changed in the document since the scene last applied a change set: the ids of created,
 * updated and deleted objects, plus a {@link SceneSource} over the document after the change.
 * The scene reads every listed id through `get`, so an id's final state decides what happens to
 * it: an object `get` returns is created or updated, one it does not is removed. Children of an
 * updated object need not be listed; the scene refreshes them itself, because their world
 * transform depends on their ancestors.
 */
export interface SceneChangeSet extends SceneSource {
  /** Objects added to the document. */
  readonly created: readonly ObjectId[];
  /** Objects whose fields changed. */
  readonly updated: readonly ObjectId[];
  /** Objects removed from the document. */
  readonly deleted: readonly ObjectId[];
}
