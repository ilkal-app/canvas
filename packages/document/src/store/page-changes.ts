import type { PageId, StyleId, TokenId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { parsePageKey } from '../pages/page-map.js';
import { parseStyleKey } from '../styles/style-map.js';
import { parseTokenKey } from '../tokens/token-map.js';

import type { ChangeSet } from './document-store.js';

/**
 * The pages whose keys a transaction changed: each changed key's page, once, sorted.
 * A key of no page field is left out.
 *
 * @param keys - The changed keys of the pages map.
 * @returns The page ids.
 */
export function changedPageIds(keys: Iterable<string>): PageId[] {
  const ids = new Set<PageId>();
  for (const key of keys) {
    const parsed = parsePageKey(key);
    if (parsed !== undefined) ids.add(parsed.pageId);
  }
  return [...ids].sort();
}

/**
 * The colour tokens whose keys a transaction changed: each changed key's token, once,
 * sorted. A key of no token field is left out.
 *
 * @param keys - The changed keys of the tokens map.
 * @returns The token ids.
 */
export function changedTokenIds(keys: Iterable<string>): TokenId[] {
  const ids = new Set<TokenId>();
  for (const key of keys) {
    const parsed = parseTokenKey(key);
    if (parsed !== undefined) ids.add(parsed.tokenId);
  }
  return [...ids].sort();
}

/**
 * The named styles of one kind whose keys a transaction changed: each changed key's
 * style, once, sorted. A key of no style field is left out.
 *
 * @param keys - The changed keys of the kind's map.
 * @returns The style ids.
 */
export function changedStyleIds(keys: Iterable<string>): StyleId[] {
  const ids = new Set<StyleId>();
  for (const key of keys) {
    const parsed = parseStyleKey(key);
    if (parsed !== undefined) ids.add(parsed.styleId);
  }
  return [...ids].sort();
}

/** The pages, colour tokens and named styles a transaction changed, beside its objects. */
export interface SideChanges {
  /** The pages changed, or `undefined` for none. */
  readonly pages?: readonly PageId[] | undefined;
  /** The colour tokens changed, or `undefined` for none. */
  readonly tokens?: readonly TokenId[] | undefined;
  /** The text styles changed, or `undefined` for none. */
  readonly textStyles?: readonly StyleId[] | undefined;
  /** The effect styles changed, or `undefined` for none. */
  readonly effectStyles?: readonly StyleId[] | undefined;
}

/**
 * Whether side changes hold anything.
 *
 * @param side - The pages and tokens changed.
 * @returns True when either is non-empty.
 */
export function hasSideChanges(side: SideChanges): boolean {
  return (
    (side.pages?.length ?? 0) > 0 ||
    (side.tokens?.length ?? 0) > 0 ||
    (side.textStyles?.length ?? 0) > 0 ||
    (side.effectStyles?.length ?? 0) > 0
  );
}

/**
 * Adds the pages and tokens a transaction changed to its change set.
 *
 * @param changes - The objects' change set.
 * @param side - The pages and tokens changed.
 * @returns The change set, with `pages` and `tokens` when there are any.
 */
export function withPageChanges(changes: ChangeSet, side: SideChanges): ChangeSet {
  if (!hasSideChanges(side)) return changes;
  const { pages, tokens, textStyles, effectStyles } = side;
  return Object.freeze({
    ...changes,
    ...(pages === undefined || pages.length === 0 ? {} : { pages: Object.freeze([...pages]) }),
    ...(tokens === undefined || tokens.length === 0 ? {} : { tokens: Object.freeze([...tokens]) }),
    ...(textStyles === undefined || textStyles.length === 0
      ? {}
      : { textStyles: Object.freeze([...textStyles]) }),
    ...(effectStyles === undefined || effectStyles.length === 0
      ? {}
      : { effectStyles: Object.freeze([...effectStyles]) }),
  });
}

/**
 * The change set of a transaction that changed pages or tokens and no object.
 *
 * @param side - The pages and tokens changed.
 * @param origin - The transaction's origin.
 * @param isLocal - Whether it was local.
 * @returns A frozen change set.
 */
export function pageOnlyChanges(
  side: SideChanges,
  origin: TransactionOrigin,
  isLocal: boolean,
): ChangeSet {
  const empty: ChangeSet = Object.freeze({
    origin,
    isLocal,
    created: Object.freeze([]),
    updated: Object.freeze([]),
    deleted: Object.freeze([]),
  });
  return withPageChanges(empty, side);
}
