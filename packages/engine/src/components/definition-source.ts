import {
  mainClosure,
  namedSwapTargets,
  type Board,
  type BoardObject,
  type ChildIndex,
  type DefinitionReader,
  type ObjectId,
} from '@canvas/schema';

/** Indexed whole-board definitions, including mains on pages the scene does not show. */
export interface DefinitionSource {
  /** Reads a real object, without restricting its page. */
  get(id: ObjectId): BoardObject | undefined;
  /** Lists real direct children, without expanding instances. */
  childrenOf(parentId: ObjectId | null): Iterable<ObjectId>;
  /** Lists real instances referencing a main. */
  instancesOf(mainId: ObjectId): Iterable<ObjectId>;
}

/** A bounded definition graph and the ids whose edits invalidate it. */
export interface DefinitionGraph {
  readonly board: Board;
  readonly children: ChildIndex;
  readonly dependencies: ReadonlySet<ObjectId>;
  /** Mains reached only by reference, never as another definition's content. */
  readonly references: ReadonlySet<ObjectId>;
}

/**
 * Collects only reachable definitions, never enumerating the board's roots: the main, its
 * content, and every main a nested instance stores or a record or preset names as a swap target
 * (`mainClosure`), transitively, so resolution finds a swapped-in main and an edit to
 * one reaches the instances that may show it.
 *
 * @param source - Whole-board indexed access.
 * @param mainId - First referenced definition.
 * @param swapTargets - Further mains the instance's own records name as swap targets.
 * @returns A resolver board and reusable child index.
 */
export function collectDefinition(
  source: DefinitionSource,
  mainId: ObjectId,
  swapTargets: readonly ObjectId[] = [],
): DefinitionGraph {
  const objects = new Map<ObjectId, BoardObject>();
  const children = new Map<ObjectId | null, readonly ObjectId[]>();
  const references = new Set<ObjectId>([mainId, ...swapTargets]);
  const content = new Set<ObjectId>();
  const reader: DefinitionReader = {
    get(id) {
      const object = source.get(id);
      if (object === undefined) return undefined;
      objects.set(id, object);
      if (object.type === 'instance') references.add(object.mainId);
      for (const target of namedSwapTargets(object)) references.add(target);
      return object;
    },
    childrenOf(id) {
      const ids = [...source.childrenOf(id)];
      children.set(id, ids);
      for (const child of ids) content.add(child);
      return ids;
    },
  };
  const dependencies = mainClosure(reader, [mainId, ...swapTargets]);
  for (const id of content) references.delete(id);
  return { board: { objects }, children, dependencies, references };
}
