import type { BoardObject, InstanceReferenceIssue, ObjectId } from '@canvas/schema';

import * as engine from '../../index.js';
import type { SceneChangeSet, SceneSource } from '../../scene/scene-source.js';

// Engine acceptance: the tests reach the
// future exports by name through this fixture, so they compile and lint on the base and fail red
// with `missing export: <name>` until the export lands. The types restate the agreed
// adapter API; the real exports replace them when they exist.

/**
 * Whole-board reads the expansion resolves definitions through: never page-scoped, so a main on
 * another page still resolves. The app passes the unscoped store; tests count every call.
 */
export interface DefinitionSource {
  /**
   * Reads an object anywhere on the board.
   *
   * @param id - The object id.
   * @returns The object, or undefined when the board has none.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * The children of a parent anywhere on the board.
   *
   * @param parentId - The parent, or null for the root.
   * @returns Their ids, in no particular order.
   */
  childrenOf(parentId: ObjectId | null): Iterable<ObjectId>;
  /**
   * The stored instances of a main anywhere on the board.
   *
   * @param mainId - The component.
   * @returns Their ids.
   */
  instancesOf(mainId: ObjectId): Iterable<ObjectId>;
}

/** What a shown instance resolved to, for the placeholder and the app's later wording. */
export interface InstanceStatus {
  /** Why expansion stopped, when it did. */
  readonly issue?: InstanceReferenceIssue;
  /** Whether the root main is retired (deleted, or its creation undone) but retained. */
  readonly isMainRetired: boolean;
  /** Whether the instance resolved to no virtual content. */
  readonly isEmpty: boolean;
}

/** The engine's transient component resolution at the change-set boundary. */
export interface InstanceExpansionApi {
  /**
   * Wraps one shown change set: virtual descendants of shown instances created, updated and
   * deleted, retired mains and their subtrees absent. Its `get` answers virtual ids.
   *
   * @param changes - What the page view delivered.
   * @returns The change set to enqueue.
   */
  expand(changes: SceneChangeSet): SceneChangeSet;
  /**
   * Re-resolves the shown instances whose definitions a board-wide change touched, on any page,
   * including deletions and moves out of a main the board no longer records.
   *
   * @param changed - Every id the board change set listed.
   * @param shown - The page view's reads.
   * @returns The change set to enqueue, or undefined when no shown instance depends on them.
   */
  dependentsOf(changed: Iterable<ObjectId>, shown: SceneSource): SceneChangeSet | undefined;
  /**
   * The real instance a virtual id belongs to (the outermost one); a shown real id is itself.
   *
   * @param id - Any id the scene may hold.
   * @returns The owner, or undefined for an id the expansion does not know.
   */
  ownerOf(id: string): ObjectId | undefined;
  /**
   * A shown instance's resolution status.
   *
   * @param instanceId - The real instance.
   * @returns Its status, or undefined when it is not shown.
   */
  statusOf(instanceId: ObjectId): InstanceStatus | undefined;
  /** How many virtual objects the expansion currently holds. */
  readonly virtualCount: number;
}

/** The constructor of {@link InstanceExpansionApi}. */
export type InstanceExpansionClass = new (definitions: DefinitionSource) => InstanceExpansionApi;

/** The engine exports's second slice adds, by name. */
export type ExpectedExportName = 'InstanceExpansion' | 'isVirtualObjectId';

/** The type of each expected export, as the contract declares it. */
export type ExpectedExport<Name extends ExpectedExportName> = Name extends 'InstanceExpansion'
  ? InstanceExpansionClass
  : (id: string) => boolean;

/**
 * Reads one of the exports adds to `@canvas/engine` from the package namespace, typed as
 * the contract declares it.
 *
 * @param name - The export's name.
 * @returns The export.
 * @throws {Error} `missing export: <name>` when the package does not export it yet.
 */
export function expectedExport<Name extends ExpectedExportName>(name: Name): ExpectedExport<Name> {
  const value = (engine as Readonly<Record<string, unknown>>)[name];
  if (typeof value !== 'function') throw new Error(`missing export: ${name}`);
  return value as ExpectedExport<Name>;
}
