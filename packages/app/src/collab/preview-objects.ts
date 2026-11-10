import type { SceneSource } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

/**
 * Captures a viewport's drawing candidates with all transform and clipping ancestors.
 * Candidate ids must include any non-parent render dependencies and come from settled
 * renderer drawing bounds, not just stored geometry.
 *
 * @param source - The same immutable board view used for the snapshot.
 * @param candidates - Every object that can draw in the covered viewport.
 * @returns The candidates plus their complete ancestor chains, or undefined for an incomplete/cyclic view.
 */
export function previewObjects(
  source: SceneSource,
  candidates: Iterable<ObjectId>,
): readonly BoardObject[] | undefined {
  const found = new Map<ObjectId, BoardObject>();
  for (const candidate of candidates) {
    const chain: BoardObject[] = [];
    const path = new Set<ObjectId>();
    let id: ObjectId | null = candidate;
    while (id !== null && !found.has(id)) {
      if (path.has(id)) return undefined;
      path.add(id);
      const object = source.get(id);
      if (object?.id !== id) return undefined;
      chain.push(object);
      id = object.parentId;
    }
    for (const object of chain.reverse()) found.set(object.id, object);
  }
  return [...found.values()];
}
