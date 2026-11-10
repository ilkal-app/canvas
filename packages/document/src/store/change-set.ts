import type { ObjectId, PageId, TokenId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';

import type { NamedStyleChanges } from './style-store.js';

/**
 * What one transaction changed, by object id, delivered to `subscribe` listeners once per
 * transaction (local or remote) that changed at least one entry. Ids are sorted, and an id
 * appears in at most one list.
 */
export interface ChangeSet extends NamedStyleChanges {
  /** The transaction's origin; for a remote update, the origin given to `applyUpdate`. */
  readonly origin: TransactionOrigin;
  /**
   * `true` for `transact`, `false` for `applyUpdate`. Also `true`, with `SYSTEM_ORIGIN`,
   * `false` also describes a role-driven view projection without document-update bytes.
   * `true` applies to the formatting cleanup Yjs runs as its own transaction right after a remote change to
   * formatted text: one `applyUpdate` can therefore deliver two change sets (and two updates).
   */
  readonly isLocal: boolean;
  /** Entries added to the object map, plus unmodified entries newly exposed by projection. */
  readonly created: readonly ObjectId[];
  /** Entries whose fields, text, networks or virtual placement changed, or were replaced. */
  readonly updated: readonly ObjectId[];
  /** Entries removed from the object map, plus unmodified entries hidden by projection. */
  readonly deleted: readonly ObjectId[];
  /**
   * The pages whose stored keys the transaction changed, sorted; absent when it changed
   * none.
   */
  readonly pages?: readonly PageId[];
  /** The colour tokens whose stored keys the transaction changed, sorted, if any. */
  readonly tokens?: readonly TokenId[];
}
