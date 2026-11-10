import type * as Y from 'yjs';

import type { PageId, StyleId, TokenId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { StyleKind } from '../styles/style-map.js';

import type { ChangeSet } from './document-store.js';
import { notifyAll } from './notify-all.js';
import {
  changedPageIds,
  changedStyleIds,
  changedTokenIds,
  hasSideChanges,
  pageOnlyChanges,
  withPageChanges,
  type SideChanges,
} from './page-changes.js';
import type { SideMaps } from './side-maps.js';

/** What the page events reach of their store. */
export interface PageEventsHost {
  /** The decoded view, whose pages and colour tokens are marked stale on a change. */
  readonly cache: { markPagesChanged(): void; markTokensChanged(): void };
  /** The named style tables, marked stale on a change of their map. */
  readonly styles: { markChanged(kind: StyleKind, styleIds: Iterable<StyleId>): void };
  /** Whether an `applyUpdate` is running (its page changes feed the page repair, R1). */
  readonly isApplyingUpdate: () => boolean;
  /**
   * The validated origin of a Yjs transaction origin.
   *
   * @param origin - The Yjs origin.
   * @returns The store's origin.
   */
  readonly originOf: (origin: unknown) => TransactionOrigin;
  /** The store's change listeners. */
  readonly listeners: ReadonlySet<(changes: ChangeSet) => void>;
}

/**
 * The store's side of the pages map, the colour tokens map and the named style maps: marks the
 * decoded pages or tokens stale on every change, remembers which pages and tokens a transaction
 * changed until its change set goes out (the objects' deep observer, which Yjs calls after the
 * top-level maps' observers, joins them into one change set; a transaction that changed no
 * object has a change set of pages and tokens only, after its observers), and whether an applied
 * update changed the pages. Single-threaded.
 */
export class PageEvents {
  readonly #host: PageEventsHost;
  #pending: readonly PageId[] | undefined;
  #pendingTokens: readonly TokenId[] | undefined;
  #pendingTextStyles: readonly StyleId[] | undefined;
  #pendingEffectStyles: readonly StyleId[] | undefined;
  #isChangedByUpdate = false;

  /**
   * Creates the page events of one store.
   *
   * @param host - The store.
   */
  constructor(host: PageEventsHost) {
    this.#host = host;
  }

  /**
   * The pages map's observer.
   *
   * @param event - The event of one transaction.
   */
  readonly onPageEvent = (event: Y.YMapEvent<unknown>): void => {
    this.#host.cache.markPagesChanged();
    if (this.#host.isApplyingUpdate()) this.#isChangedByUpdate = true;
    const pages = changedPageIds(event.keysChanged);
    if (pages.length > 0) this.#pending = pages;
  };

  /**
   * The tokens map's observer.
   *
   * @param event - The event of one transaction.
   */
  readonly onTokenEvent = (event: Y.YMapEvent<unknown>): void => {
    this.#host.cache.markTokensChanged();
    const tokens = changedTokenIds(event.keysChanged);
    if (tokens.length > 0) this.#pendingTokens = tokens;
  };

  /**
   * The text styles map's observer.
   *
   * @param event - The event of one transaction.
   */
  readonly onTextStyleEvent = (event: Y.YMapEvent<unknown>): void => {
    const styles = changedStyleIds(event.keysChanged);
    this.#host.styles.markChanged('text', styles);
    if (styles.length > 0) this.#pendingTextStyles = styles;
  };

  /**
   * The effect styles map's observer.
   *
   * @param event - The event of one transaction.
   */
  readonly onEffectStyleEvent = (event: Y.YMapEvent<unknown>): void => {
    const styles = changedStyleIds(event.keysChanged);
    this.#host.styles.markChanged('effect', styles);
    if (styles.length > 0) this.#pendingEffectStyles = styles;
  };

  /**
   * Starts or stops observing a document's pages, tokens and style maps and its transactions.
   *
   * @param maps - The document and its maps.
   * @param isObserving - True to start, false to stop.
   */
  observe(maps: SideMaps, isObserving: boolean): void {
    if (isObserving) {
      maps.pages.observe(this.onPageEvent);
      maps.tokens.observe(this.onTokenEvent);
      maps.textStyles.observe(this.onTextStyleEvent);
      maps.effectStyles.observe(this.onEffectStyleEvent);
      maps.doc.on('afterTransaction', this.onAfterTransaction);
    } else {
      maps.pages.unobserve(this.onPageEvent);
      maps.tokens.unobserve(this.onTokenEvent);
      maps.textStyles.unobserve(this.onTextStyleEvent);
      maps.effectStyles.unobserve(this.onEffectStyleEvent);
      maps.doc.off('afterTransaction', this.onAfterTransaction);
    }
  }

  /**
   * Takes the pages and tokens pending delivery.
   *
   * @returns What the transaction changed beside its objects.
   */
  #takePending(): SideChanges {
    const side = {
      pages: this.#pending,
      tokens: this.#pendingTokens,
      textStyles: this.#pendingTextStyles,
      effectStyles: this.#pendingEffectStyles,
    };
    this.#pending = undefined;
    this.#pendingTokens = undefined;
    this.#pendingTextStyles = undefined;
    this.#pendingEffectStyles = undefined;
    return side;
  }

  /**
   * Delivers the change set of a transaction that changed pages or tokens and no object.
   *
   * @param transaction - The Yjs transaction, after its observers ran.
   */
  readonly onAfterTransaction = (transaction: Y.Transaction): void => {
    const side = this.#takePending();
    if (!hasSideChanges(side)) return;
    const origin = this.#host.originOf(transaction.origin);
    notifyAll(this.#host.listeners, pageOnlyChanges(side, origin, transaction.local));
  };

  /**
   * Joins the pending pages and tokens to a transaction's objects change set, and delivers it.
   *
   * @param changes - The objects' change set, or `undefined` when no object changed.
   * @param origin - The transaction's origin.
   * @param isLocal - Whether it was local.
   */
  deliver(changes: ChangeSet | undefined, origin: TransactionOrigin, isLocal: boolean): void {
    const side = this.#takePending();
    if (changes !== undefined) {
      notifyAll(this.#host.listeners, withPageChanges(changes, side));
    } else if (hasSideChanges(side)) {
      notifyAll(this.#host.listeners, pageOnlyChanges(side, origin, isLocal));
    }
  }

  /**
   * Whether the update applied since the last call changed the pages; resets it.
   *
   * @returns True when it did.
   */
  takeUpdateChange(): boolean {
    const isChanged = this.#isChangedByUpdate;
    this.#isChangedByUpdate = false;
    return isChanged;
  }
}
