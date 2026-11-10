import { notifyAll } from '../store/notify-all.js';

import type { UndoHistoryState } from './undo-history-state.js';

/** A history's subscribers (`UndoHistory.subscribe`), told when whether it can undo or redo changes. */
export class HistoryStateListeners {
  readonly #listeners = new Set<(state: UndoHistoryState) => void>();
  #last: UndoHistoryState = { canUndo: false, canRedo: false };

  /**
   * Adds a subscriber.
   *
   * @param listener - Called with the new state.
   * @returns Removes it.
   */
  add(listener: (state: UndoHistoryState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Removes every subscriber. */
  clear(): void {
    this.#listeners.clear();
  }

  /**
   * Calls every subscriber with the state when it differs from the last one delivered, even when
   * one throws, then rethrows the first error.
   *
   * @param canUndo - Whether the history can undo now.
   * @param canRedo - Whether it can redo now.
   * @throws {unknown} The first error a subscriber threw.
   */
  notifyIfChanged(canUndo: boolean, canRedo: boolean): void {
    if (canUndo === this.#last.canUndo && canRedo === this.#last.canRedo) return;
    this.#last = Object.freeze({ canUndo, canRedo });
    notifyAll(this.#listeners, this.#last);
  }
}
