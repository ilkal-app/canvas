import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';

import { collectChangedKeys } from './change-collector.js';
import type { ChangeSet } from './document-store.js';
import type { ObjectCache } from './object-cache.js';
import { visibleChanges } from './visible-changes.js';

/**
 * Collects raw changes for repair and, when observed, changes in the projected readable view.
 *
 * @param events - One transaction's deep object-map events.
 * @param source - The document's object map.
 * @param cache - The decoded view.
 * @param touched - The remote update's repair candidates, when collecting one.
 * @param origin - The validated origin to report.
 * @param isLocal - Whether the source transaction was local.
 * @param hasListeners - Whether a change set needs to be materialized now.
 * @returns The change set, or undefined for a transaction with no object changes.
 */
export function objectEventChanges(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
  source: Y.Map<unknown>,
  cache: ObjectCache,
  touched: Set<ObjectId> | undefined,
  origin: TransactionOrigin,
  isLocal: boolean,
  hasListeners: boolean,
): ChangeSet | undefined {
  const keys = collectChangedKeys(events, source);
  for (const changed of [keys.created, keys.updated, keys.deleted]) {
    for (const key of changed) touched?.add(key as ObjectId);
    cache.markChanged(changed);
  }
  if (keys.created.size + keys.updated.size + keys.deleted.size === 0) return undefined;
  return visibleChanges(keys, hasListeners ? cache.flushForNotification() : [], origin, isLocal);
}

/** What a store's object events observer reaches of its store. */
export interface ObjectEventsHost {
  /** The store's origins, to read a transaction's origin. */
  readonly origins: { of(origin: unknown): TransactionOrigin };
  /** The object map. */
  readonly source: Y.Map<unknown>;
  /** The decoded view. */
  readonly cache: ObjectCache;
  /** The ids an `applyUpdate` in progress changed, collected for the reference repair. */
  readonly touched: () => Set<ObjectId> | undefined;
  /** The store's change listeners. */
  readonly listeners: ReadonlySet<unknown>;
  /** The page events, which join the pages, tokens and styles a transaction changed. */
  readonly sideEvents: {
    deliver(changes: ChangeSet | undefined, origin: TransactionOrigin, isLocal: boolean): void;
  };
}

/**
 * The object map's deep observer of a store: marks what a transaction changed and delivers its
 * change set, joined with the side maps' changes.
 *
 * @param host - The store.
 * @returns The observer.
 */
export function objectEventsObserver(
  host: ObjectEventsHost,
): (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void {
  return (events, transaction) => {
    const origin = host.origins.of(transaction.origin);
    const changes = objectEventChanges(
      events,
      host.source,
      host.cache,
      host.touched(),
      origin,
      transaction.local,
      host.listeners.size > 0,
    );
    host.sideEvents.deliver(changes, origin, transaction.local);
  };
}
