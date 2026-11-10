import { reportAsynchronously } from '../errors/report-asynchronously.js';

import type { CollabStatus, CollabStatusListener } from './collab-client-options.js';
import { nextConnectionState, type ConnectionEvent } from './connection-state.js';

/**
 * Holds a client's {@link CollabStatus} and tells listeners when it changes: a new frozen
 * object per change, never a notification for an unchanged status. A throwing listener does
 * not starve the others; its error is rethrown from a microtask.
 */
export class CollabStatusHolder {
  readonly #listeners = new Set<CollabStatusListener>();
  #status: CollabStatus;
  #derive: (status: CollabStatus) => Partial<CollabStatus> = () => ({});

  /**
   * Starts from an initial status.
   *
   * @param initial - The status before anything happens.
   */
  constructor(initial: CollabStatus) {
    this.#status = Object.freeze({ ...initial });
  }

  /**
   * The current status.
   *
   * @returns The status; the same object until something changes.
   */
  get current(): CollabStatus {
    return this.#status;
  }

  /**
   * Listens for changes.
   *
   * @param listener - Receives each new status.
   * @returns A function that stops listening.
   */
  subscribe(listener: CollabStatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Keeps fields that follow from the rest of the status and from the client's own state up to
   * date: `derive` runs on every update, before the change is compared, and once now.
   *
   * @param derive - Computes the derived fields from the status about to be set.
   */
  deriveWith(derive: (status: CollabStatus) => Partial<CollabStatus>): void {
    this.#derive = derive;
    this.update({});
  }

  /**
   * Moves the connection state machine.
   *
   * @param event - What happened to the connection.
   */
  transition(event: ConnectionEvent): void {
    this.update({ state: nextConnectionState(this.#status.state, event) });
  }

  /**
   * Replaces fields and notifies listeners when anything changed.
   *
   * @param change - The fields to replace.
   */
  update(change: Partial<CollabStatus>): void {
    const merged = { ...this.#status, ...change };
    const next = { ...merged, ...this.#derive(merged) };
    const keys = Object.keys(next) as (keyof CollabStatus)[];
    if (keys.every((key) => next[key] === this.#status[key])) return;
    this.#status = Object.freeze(next);
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#status);
      } catch (error: unknown) {
        reportAsynchronously(error);
      }
    }
  }

  /** Drops every listener. */
  clear(): void {
    this.#listeners.clear();
  }
}
