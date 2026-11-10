import type * as Y from 'yjs';

import type { BoardTimer } from '@canvas/schema';

import { notifyAll } from '../store/notify-all.js';

import { BOARD_TIMER_KEY, readBoardTimer } from './timer-map.js';

/** The board timer as a store shows it: its value now, and its changes. */
export interface BoardTimerView {
  /** The timer as of the last completed transaction, frozen; `undefined` when there is none. */
  readonly current: BoardTimer | undefined;
  /**
   * Listens for changes of the timer, local or remote. Timer writes add no change set to the
   * store's `subscribe`.
   *
   * @param listener - Called after each transaction that changed the stored timer.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * The store's side of the facilitation map: the board timer decoded once per change,
 * and its listeners, called after each transaction that changed the `timer` key, local or
 * remote. It observes the map for the life of its document. Package-internal.
 */
export class BoardTimerEvents implements BoardTimerView {
  readonly #map: Y.Map<unknown>;
  readonly #listeners = new Set<() => void>();
  #timer: BoardTimer | undefined;

  /**
   * Observes a facilitation map.
   *
   * @param map - The document's facilitation map.
   */
  constructor(map: Y.Map<unknown>) {
    this.#map = map;
    this.#timer = readBoardTimer(map);
    map.observe(this.#onEvent);
  }

  /** @inheritdoc */
  get current(): BoardTimer | undefined {
    return this.#timer;
  }

  /** @inheritdoc */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  readonly #onEvent = (event: Y.YMapEvent<unknown>): void => {
    if (!event.keysChanged.has(BOARD_TIMER_KEY)) return;
    this.#timer = readBoardTimer(this.#map);
    notifyAll(this.#listeners, undefined);
  };
}
