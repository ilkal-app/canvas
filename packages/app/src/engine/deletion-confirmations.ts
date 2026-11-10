import type { ComponentDeletion } from './component-deletion.js';

/** A deletion waiting for the person's answer (ruling 6). */
export interface PendingDeletion {
  /** What it would do to components. */
  readonly deletion: ComponentDeletion;
  /** Deletes, as the person asked; nothing once answered. Unbound, so a button may take it. */
  readonly confirm: () => void;
  /** Keeps everything; nothing once answered. Unbound, so a button may take it. */
  readonly cancel: () => void;
}

/** Where the shell's confirmation dialog reads the deletion waiting for an answer. */
export interface DeletionConfirmationSource {
  /**
   * The deletion waiting for an answer.
   *
   * @returns It, or undefined when none waits.
   */
  current(): PendingDeletion | undefined;
  /**
   * Calls `listener` whenever a deletion starts or stops waiting.
   *
   * @param listener - The listener.
   * @returns A function that unsubscribes.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * The person's deletions that would detach instances, held until they answer (ruling
 * 6): the canvas's Delete, the context menu's and a cut ask here before deleting a main. With
 * nobody listening (no dialog mounted: a test, an embed without the shell's dialog) a deletion
 * goes ahead at once, as before. A new question replaces one still waiting, which is cancelled.
 * Agents never come here: their commands run directly. Main thread.
 */
export class DeletionConfirmations implements DeletionConfirmationSource {
  private readonly listeners = new Set<() => void>();
  private pending: PendingDeletion | undefined;

  current(): PendingDeletion | undefined {
    return this.pending;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Asks the person about a deletion, or deletes at once when nobody can be asked.
   *
   * @param deletion - What it would do to components.
   * @param proceed - Deletes; called at most once, and only if the person confirms.
   */
  ask(deletion: ComponentDeletion, proceed: () => void): void {
    if (this.listeners.size === 0) {
      proceed();
      return;
    }
    this.pending?.cancel();
    const answer = (isConfirmed: boolean): void => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      if (isConfirmed) proceed();
      this.notify();
    };
    const pending: PendingDeletion = {
      deletion,
      confirm: () => {
        answer(true);
      },
      cancel: () => {
        answer(false);
      },
    };
    this.pending = pending;
    this.notify();
  }

  /** Cancels a deletion still waiting and drops the listeners. */
  destroy(): void {
    this.pending = undefined;
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
