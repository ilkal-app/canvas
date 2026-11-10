import {
  DEFAULT_PAGE_ID,
  instanceReferenceProblems,
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

/** One deterministic source placement removed from a component reference graph. */
export interface InstanceReferenceBreak {
  /** Original source instance. */
  readonly stored: BoardObject;
  /** Same instance at the board root, with world placement preserved. */
  readonly shown: BoardObject;
}

/**
 * Finds the outer page and whether a placement contributes an edge inside a main definition.
 *
 * @param board - Parent-cycle-free board.
 * @param object - Source instance.
 * @returns Its page when nested in a main, or undefined when it contributes no nested edge.
 */
function definitionPage(board: Board, object: BoardObject) {
  let current = object;
  let isNested = false;
  const seen = new Set<ObjectId>();
  while (current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = board.objects.get(current.parentId);
    if (parent === undefined) break;
    if (parent.type === 'component') isNested = true;
    current = parent;
  }
  return isNested ? (current.pageId ?? DEFAULT_PAGE_ID) : undefined;
}

/**
 * Breaks merged cycles and excessive expansion depth by re-rooting the lowest-id source edge.
 * Stored content, identity, main references and overrides are preserved. No inputs are mutated.
 *
 * @param board - Board after parent cycles have been projected away.
 * @returns Deterministic placement-only repairs, in selection order.
 */
export function findInstanceReferenceBreaks(board: Board): readonly InstanceReferenceBreak[] {
  const objects = new Map(board.objects);
  const view = { ...board, objects };
  const result: InstanceReferenceBreak[] = [];
  for (;;) {
    const candidates = new Set<ObjectId>();
    for (const problem of instanceReferenceProblems(view).values()) {
      if (problem.code !== 'instance-cycle' && problem.code !== 'instance-depth') continue;
      for (const id of problem.chain) {
        const object = objects.get(id);
        if (object !== undefined && definitionPage(view, object) !== undefined) candidates.add(id);
      }
    }
    const id = [...candidates].sort()[0];
    const stored = id === undefined ? undefined : objects.get(id);
    if (stored === undefined) return result;
    const world = objectToBoardTransform(view, stored);
    const shown = {
      ...stored,
      parentId: null,
      pageId: definitionPage(view, stored) ?? DEFAULT_PAGE_ID,
      x: world.x,
      y: world.y,
      rotation: Math.atan2(world.sin, world.cos),
    };
    objects.set(stored.id, shown);
    result.push({ stored, shown });
  }
}
