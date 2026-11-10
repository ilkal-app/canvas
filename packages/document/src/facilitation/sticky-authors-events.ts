import type * as Y from 'yjs';

import { notifyAll } from '../store/notify-all.js';

import { readStickyAuthors, STICKY_AUTHORS_KEY } from './sticky-authors-map.js';

/** The board's sticky author setting as of the last transaction, and its change listeners. */
export interface StickyAuthorsView {
  /** Whether the board shows authors on its stickies. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- `current`, as the store's other views name their value (BoardTimerView).
  readonly current: boolean;
  /**
   * Listens for the setting's changes, local or remote (not the timer's).
   *
   * @param listener - Called after each change.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Keeps the board's sticky author setting from the facilitation map and tells its
 * listeners when that key changes. Main thread.
 */
export class StickyAuthorsEvents implements StickyAuthorsView {
  readonly #map: Y.Map<unknown>;
  readonly #listeners = new Set<() => void>();
  #isShown: boolean;

  /**
   * Starts following the map.
   *
   * @param map - The facilitation map.
   */
  constructor(map: Y.Map<unknown>) {
    this.#map = map;
    this.#isShown = readStickyAuthors(map);
    map.observe(this.#onEvent);
  }

  /** @inheritdoc */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- `current`, as StickyAuthorsView names it.
  get current(): boolean {
    return this.#isShown;
  }

  /** @inheritdoc */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  readonly #onEvent = (event: Y.YMapEvent<unknown>): void => {
    if (!event.keysChanged.has(STICKY_AUTHORS_KEY)) return;
    const isShown = readStickyAuthors(this.#map);
    if (isShown === this.#isShown) return;
    this.#isShown = isShown;
    notifyAll(this.#listeners, undefined);
  };
}
