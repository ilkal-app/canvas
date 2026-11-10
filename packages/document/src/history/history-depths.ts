import type { UndoHistory } from './undo-manager.js';

// Package-internal, for tests: how many steps a history holds on each stack. `UndoHistory`
// tells only whether there is a step (`canUndo`, `canRedo`); the property test's model of the
// stacks (`__fixtures__/undo-oracle.ts`) counts steps, so a step dropped or doubled is caught.
// Not exported from `src/index.ts`.

/** The number of steps on each stack of a history. */
export interface HistoryDepths {
  /** Steps that can be undone. */
  readonly undo: number;
  /** Steps that can be redone. */
  readonly redo: number;
}

/** Each live history's reader of its stack depths, registered by its constructor. */
const registry = new WeakMap<UndoHistory, () => HistoryDepths>();

/**
 * Registers how to read a history's stack depths; called once, by the history's constructor.
 *
 * @param history - The history.
 * @param read - Reads its depths now.
 */
export function registerDepths(history: UndoHistory, read: () => HistoryDepths): void {
  registry.set(history, read);
}

/**
 * Reads how many steps a history holds on each stack.
 *
 * @param history - A history made by `createHistory`.
 * @returns Its depths.
 * @throws {TypeError} When the history was not made by `createHistory`.
 */
export function depthsOf(history: UndoHistory): HistoryDepths {
  const read = registry.get(history);
  if (read === undefined) throw new TypeError('Not a history made by createHistory');
  return read();
}
