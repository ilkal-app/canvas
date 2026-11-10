import type { TransactionOrigin } from '../origin/transaction-origin.js';

/** One transaction's Yjs update, for the sync client to send or persist. */
export interface DocumentUpdate {
  /** The update, Yjs update format v1. */
  readonly update: Uint8Array;
  /** The transaction's origin. */
  readonly origin: TransactionOrigin;
  /**
   * `true` for `transact` and for Yjs's formatting cleanup after a remote change (see
   * `ChangeSet.isLocal`); `false` for `applyUpdate`.
   */
  readonly isLocal: boolean;
}

/** How `DocumentStore.applyUpdate` applies an update. */
export interface ApplyUpdateOptions {
  /**
   * Whether update listeners are left out of this update: they are not handed its bytes, so the
   * store need not encode them (restoring a large cached board encoded the whole snapshot for
   * nobody). Change listeners still hear its changes, and update listeners still hear
   * any repair transaction it causes. Default false.
   */
  readonly isSilent?: boolean;
}

/** How `DocumentStore.applyUpdateInSteps` applies an update. */
export interface ApplyUpdateInStepsOptions extends ApplyUpdateOptions {
  /**
   * Lets the browser run other tasks (input, frames) between the steps of the apply, as
   * `yieldToBrowser` in `@canvas/collab` does. A rejection rejects the apply.
   */
  readonly yieldToBrowser: () => Promise<void>;
}
