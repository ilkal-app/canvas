import {
  applyLinkUnfurl,
  retryLinkUnfurlCommand,
  runCommand,
  type CommandEnvironment,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';

import type { PasteTarget } from '../clipboard/paste-handlers.js';

/**
 * A paste target's link card writes: the pasting client writes its card's preview, the
 * one writer, and puts a failed card back to pending for its Retry.
 *
 * @param edits - The store, the person's origin and the command environment.
 * @param edits.store - The board.
 * @param edits.origin - Who writes.
 * @param edits.environment - The clock and ids.
 * @returns The target's `applyLinkUnfurl` and `retryLinkUnfurl`.
 */
export function linkCardWritesOf(edits: {
  readonly store: DocumentStore;
  readonly origin: TransactionOrigin;
  readonly environment: CommandEnvironment;
}): Pick<PasteTarget, 'applyLinkUnfurl' | 'retryLinkUnfurl'> {
  const { store, origin, environment } = edits;
  return {
    applyLinkUnfurl: (id, update) => applyLinkUnfurl(store, id, update, origin, environment),
    retryLinkUnfurl: (id, unfurlKey) =>
      runCommand(store, origin, retryLinkUnfurlCommand, { id, unfurlKey }, environment).status ===
      'applied',
  };
}
