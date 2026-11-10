// A board view over plain objects in memory, for panel tests that need a very large board
// (50k objects) without building a Yjs document. It reads like `DocumentBoardView`; changes are
// pushed by hand with `emit`.
import { generateNKeysBetween, type BoardReader, type ChangeSet } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { BoardView, BoardViewChange, BoardViewState } from '../../engine/board-view.js';

/** A {@link BoardView} over a map of objects, with a way to push change sets. */
export interface MemoryBoardView extends BoardView {
  /** The objects by id; change them, then `emit`. */
  readonly objects: Map<ObjectId, BoardObject>;
  /**
   * Re-indexes the objects and tells the listeners about a change set.
   *
   * @param changes - What changed.
   * @param isLocal - Whether it is this page's own (true if absent) or a collaborator's.
   */
  emit(changes: Omit<ChangeSet, 'origin' | 'isLocal'>, isLocal?: boolean): void;
}

/**
 * A shape at the root of the board, stacked by `z`.
 *
 * @param id - Its id.
 * @param z - Its stacking key.
 * @param parentId - Its parent; the root if absent.
 * @returns The shape.
 */
export function memoryShape(id: string, z: string, parentId: string | null = null): BoardObject {
  return {
    id,
    type: 'shape',
    kind: 'rectangle',
    parentId,
    x: 0,
    y: 0,
    rotation: 0,
    z,
    locked: false,
    width: 10,
    height: 10,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 3,
    label: null,
    createdBy: 'user:test',
    createdAt: 0,
    updatedAt: 0,
  } as unknown as BoardObject;
}

/**
 * `count` shapes at the root, bottom first, ids `shape-0`…
 *
 * @param count - How many.
 * @returns The shapes.
 */
export function memoryShapes(count: number): BoardObject[] {
  const keys = generateNKeysBetween(null, null, count);
  return keys.map((z, index) => memoryShape(`shape-${String(index)}`, z));
}

/**
 * A board view over the given objects, with nothing selected.
 *
 * @param objects - The objects.
 * @returns The view.
 */
export function createMemoryBoardView(objects: readonly BoardObject[]): MemoryBoardView {
  const map = new Map(objects.map((object) => [object.id, object]));
  let children = new Map<ObjectId | null, Set<ObjectId>>();
  const index = () => {
    children = new Map();
    for (const object of map.values()) {
      const set = children.get(object.parentId) ?? new Set();
      set.add(object.id);
      children.set(object.parentId, set);
    }
  };
  index();
  const empty: ReadonlySet<ObjectId> = new Set();
  const board: BoardReader = {
    get: (id) => map.get(id),
    references: {
      childrenOf: (parentId) => children.get(parentId) ?? empty,
      topChildOf: () => undefined,
      connectorsAttachedTo: () => empty,
      commentsAnchoredTo: () => empty,
      instancesOf: (mainId) =>
        new Set(
          [...map.values()]
            .filter((object) => object.type === 'instance' && object.mainId === mainId)
            .map(({ id }) => id),
        ),
    },
  };
  const listeners = new Set<(change: BoardViewChange) => void>();
  let state: BoardViewState = { documentVersion: 0, selectedIds: [], enteredGroupId: null };
  return {
    objects: map,
    board,
    state: () => state,
    select: (ids) => {
      state = { ...state, selectedIds: [...ids] };
      for (const listener of [...listeners]) listener({ kind: 'selection' });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (changes, isLocal = true) => {
      index();
      state = { ...state, documentVersion: state.documentVersion + 1 };
      const full: ChangeSet = {
        origin: { kind: 'system' } as ChangeSet['origin'],
        isLocal,
        ...changes,
      };
      for (const listener of [...listeners]) listener({ kind: 'document', changes: full });
    },
  };
}
