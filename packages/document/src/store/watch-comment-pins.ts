import type { ObjectId } from '@canvas/schema';

import type { DocumentStore } from './document-store.js';

/** What one of the client's own transactions did to comment pins, by thread id. */
export interface CommentPinChanges {
  /** Threads whose last pin the transaction removed, in the order removed. */
  readonly deleted: readonly string[];
  /** Threads an undo or redo gave a pin again when none had one, in the order created. */
  readonly restored: readonly string[];
}

/**
 * Watches a whole board's comment pins and tells the listener which threads one of this
 * client's own transactions took the last pin from (`deleted`), and which an undo or redo gave a
 * pin back (`restored`), so the client deletes or restores the thread in the boards service: a
 * pin deleted from any entry point (the layers panel, the Delete key, a cut, a page delete, an
 * agent's `delete_objects`) takes its thread with it, and undo brings both back. A remote change,
 * a system repair and a change that leaves another pin on the thread tell nothing; a pin created
 * by a person or an agent (placing a new comment) restores nothing. Give it the whole board's
 * store, never a page view, whose page switch removes and creates every pin of a page.
 *
 * @param store - The whole board's store.
 * @param listener - Told once per transaction that deleted or restored a thread.
 * @returns A function that stops watching.
 */
export function watchCommentPins(
  store: DocumentStore,
  listener: (changes: CommentPinChanges) => void,
): () => void {
  const pins = new Map<ObjectId, string>();
  for (const object of store.read().objects.values()) {
    if (object.type === 'comment') pins.set(object.id, object.threadId);
  }
  return store.subscribe((changes) => {
    const isOwn = changes.isLocal && changes.origin.kind !== 'system';
    const before = new Set(pins.values());
    const gone: string[] = [];
    for (const id of changes.deleted) {
      const threadId = pins.get(id);
      if (threadId === undefined) continue;
      pins.delete(id);
      gone.push(threadId);
    }
    const added: string[] = [];
    for (const id of [...changes.created, ...changes.updated]) {
      const object = store.get(id);
      if (object?.type !== 'comment') continue;
      if (!pins.has(id)) added.push(object.threadId);
      pins.set(id, object.threadId);
    }
    if (!isOwn) return;
    const after = new Set(pins.values());
    const deleted = unique(gone.filter((threadId) => !after.has(threadId)));
    const restored =
      changes.origin.kind === 'undo'
        ? unique(added.filter((threadId) => !before.has(threadId)))
        : [];
    if (deleted.length > 0 || restored.length > 0) listener({ deleted, restored });
  });
}

/**
 * The ids once each, in first order.
 *
 * @param ids - The ids.
 * @returns Them without repeats.
 */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** The boards service's thread writes a client makes for its own pin changes. */
export interface CommentThreadWrites {
  /** Marks a thread deleted. */
  deleteThread(threadId: string): Promise<unknown>;
  /** Brings a deleted thread back. */
  restoreThread(threadId: string): Promise<unknown>;
}

/** A running {@link syncCommentThreads}. */
export interface CommentThreadSync {
  /**
   * Waits until every write begun so far, and every write chained after it, has settled.
   *
   * @returns Resolves then; never rejects.
   */
  settled(): Promise<void>;
  /** Stops watching; writes already begun still run. */
  stop(): void;
}

/**
 * Keeps the boards service's threads in step with the client's own pin changes
 * (`watchCommentPins`): deletes a thread whose last pin its change removed and restores
 * one its undo pinned again. The writes of one thread run one after another, in the order of the
 * changes, so a delete and the undo right after it reach the service in that order; different
 * threads' writes run side by side. A failed write is reported and the next one still runs.
 *
 * @param store - The whole board's store.
 * @param writes - The service's writes.
 * @param onSettled - Told after each write, with its error when it failed.
 * @returns The running sync.
 */
export function syncCommentThreads(
  store: DocumentStore,
  writes: CommentThreadWrites,
  onSettled: (error?: unknown) => void = () => undefined,
): CommentThreadSync {
  const chains = new Map<string, Promise<void>>();
  const enqueue = (threadId: string, write: () => Promise<unknown>): void => {
    const previous = chains.get(threadId) ?? Promise.resolve();
    const next = previous
      .then(write)
      .then(
        () => {
          onSettled();
        },
        (error: unknown) => {
          onSettled(error);
        },
      )
      .finally(() => {
        if (chains.get(threadId) === next) chains.delete(threadId);
      });
    chains.set(threadId, next);
  };
  const stop = watchCommentPins(store, ({ deleted, restored }) => {
    for (const threadId of deleted) enqueue(threadId, () => writes.deleteThread(threadId));
    for (const threadId of restored) enqueue(threadId, () => writes.restoreThread(threadId));
  });
  return {
    settled: async () => {
      while (chains.size > 0) await Promise.all(chains.values());
    },
    stop,
  };
}
