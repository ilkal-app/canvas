import type * as Y from 'yjs';

import type { TransactionOrigin } from '../origin/transaction-origin.js';

import type { DocumentUpdate } from './document-update.js';
import { updateNotifier } from './notify-all.js';

/**
 * A store's update listeners and its Y.Doc's `update` event: Yjs encodes every
 * transaction's update while anyone listens to that event, so it is listened to only while the
 * store has an update listener, and not for the remote transaction of a silent apply. Without
 * this, a cold open of a large board encoded the whole restored snapshot, twice, for nobody.
 */
export class YjsUpdateSubscription {
  /** The store's update listeners, in subscription order. */
  readonly listeners = new Set<(update: DocumentUpdate) => void>();
  private readonly onUpdate: ReturnType<typeof updateNotifier>;
  private isListening = false;
  /** Whether a silent apply's remote transaction has yet to pass its `update` point. */
  private isMuted = false;
  /**
   * During a silent apply, a local transaction (Yjs's formatting cleanup) is heard: listening
   * resumes just before its `update` point, after the remote one's has passed unheard.
   *
   * @param transaction - The transaction Yjs is cleaning up.
   */
  private readonly onCleanup = (transaction: Y.Transaction): void => {
    if (!transaction.local) return;
    this.isMuted = false;
    this.sync();
  };

  /**
   * Starts with no listener, so the doc's `update` event is not listened to.
   *
   * @param doc - The store's Y.Doc.
   * @param originOf - The store's origin for a Yjs transaction origin.
   */
  constructor(
    private readonly doc: Y.Doc,
    originOf: (origin: unknown) => TransactionOrigin,
  ) {
    this.onUpdate = updateNotifier(this.listeners, originOf);
  }

  /**
   * Adds a listener; the first one starts listening to the doc's `update` event (after a silent
   * apply under way, if any).
   *
   * @param listener - Receives each transaction's update.
   * @returns Removes it; removing the last stops listening.
   */
  add(listener: (update: DocumentUpdate) => void): () => void {
    this.listeners.add(listener);
    this.sync();
    return () => {
      const isRemoved = this.listeners.delete(listener);
      this.sync();
      return isRemoved;
    };
  }

  /**
   * Runs work with the listeners: silently, the doc's `update` event goes unheard for the
   * remote transaction the work makes (Yjs encodes nothing for it), any local transaction it
   * causes is heard, and nothing is reported to the listeners outside Yjs (they get none).
   * Listening afterwards follows the listeners as they are then.
   *
   * @param isSilent - Whether to apply silently.
   * @param work - The work, given the listeners to report to.
   * @returns What the work returns.
   */
  applying<Result>(
    isSilent: boolean,
    work: (listeners: ReadonlySet<(update: DocumentUpdate) => void>) => Result,
  ): Result {
    if (!isSilent) return work(this.listeners);
    this.isMuted = true;
    this.sync();
    this.doc.on('afterTransactionCleanup', this.onCleanup);
    try {
      return work(NO_LISTENERS);
    } finally {
      this.doc.off('afterTransactionCleanup', this.onCleanup);
      this.isMuted = false;
      this.sync();
    }
  }

  /** Stops listening and forgets every listener. */
  clear(): void {
    this.listeners.clear();
    this.sync();
  }

  private sync(): void {
    const isOn = !this.isMuted && this.listeners.size > 0;
    if (isOn === this.isListening) return;
    this.isListening = isOn;
    if (isOn) this.doc.on('update', this.onUpdate);
    else this.doc.off('update', this.onUpdate);
  }
}

/** No listeners: what a silent apply reports to outside Yjs. */
const NO_LISTENERS: ReadonlySet<(update: DocumentUpdate) => void> = new Set();
