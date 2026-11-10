/** What the boards service changed, as the relay tells a board's clients: threads, or the vote. */
export type BoardNoticeKind = 'threads' | 'votes';

/**
 * A collab client's listeners of the relay's board notices (threads, votes): each
 * notice calls its kind's listeners, and a listener that throws is reported, never breaking the
 * transport or the other listeners.
 */
export class BoardNotices {
  readonly #listeners: Readonly<Record<BoardNoticeKind, Set<() => void>>> = {
    threads: new Set(),
    votes: new Set(),
  };
  readonly #onError: (error: unknown) => void;
  #isCleared = false;

  /**
   * Prepares the listeners.
   *
   * @param onError - Where a listener's error is reported.
   */
  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  /**
   * Adds a listener of one kind; none once cleared.
   *
   * @param kind - The notice.
   * @param listener - Called after each.
   * @returns A function that removes it.
   */
  subscribe(kind: BoardNoticeKind, listener: () => void): () => void {
    const listeners = this.#listeners[kind];
    if (!this.#isCleared) listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Calls a kind's listeners.
   *
   * @param kind - The notice that arrived.
   */
  notify(kind: BoardNoticeKind): void {
    for (const listener of [...this.#listeners[kind]]) {
      try {
        listener();
      } catch (error) {
        this.#onError(error);
      }
    }
  }

  /** Drops every listener, for good. */
  clear(): void {
    this.#isCleared = true;
    for (const listeners of Object.values(this.#listeners)) listeners.clear();
  }
}
