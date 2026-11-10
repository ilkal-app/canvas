import {
  formatReadableLayouts,
  LAYOUT_GATE_CLOSE_CODE,
  READABLE_LAYOUTS_PARAMETER,
} from '@canvas/document';

import { FRAME_TOO_LARGE_CLOSE_CODE, UPDATE_TOO_LARGE_REASON } from './update-too-large.js';

/**
 * What a socket's close means to the link: the board cannot be read by this build (terminal),
 * the relay refused the token (one fresh token, then terminal), or the connection was lost
 * (retried with backoff).
 */
export type CloseVerdict =
  | { readonly kind: 'outdated'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'lost' };

/**
 * Classifies a close from the relay. Hocuspocus's Unauthorized and Forbidden close codes (4401,
 * 4403) refuse the token like a permission-denied message does; the layout gate's 4426 is final
 * (its 4425, an update held back, is a lost connection like any other). Only an authenticated
 * 1009 means an oversized update; before acceptance the smaller pre-auth cap applies.
 *
 * @param code - The close code.
 * @param reason - The close reason; may be empty.
 * @param isAuthenticated - Whether the relay had accepted the connection's token.
 * @returns What the close means.
 */
export function classifyClose(
  code: number,
  reason: string,
  isAuthenticated: boolean,
): CloseVerdict {
  if (code === LAYOUT_GATE_CLOSE_CODE) return { kind: 'outdated', reason: reason || String(code) };
  if (code === FRAME_TOO_LARGE_CLOSE_CODE && isAuthenticated) {
    return { kind: 'outdated', reason: UPDATE_TOO_LARGE_REASON };
  }
  if (code === 4401 || code === 4403) return { kind: 'rejected', reason: reason || String(code) };
  return { kind: 'lost' };
}

/**
 * The relay URL with the layouts a client reads as its `layouts` query parameter, replacing one
 * the URL already has.
 *
 * @param url - The relay's WebSocket URL.
 * @param versions - The layouts the client reads.
 * @returns The URL to open.
 * @throws {TypeError} When `url` is not an absolute URL.
 */
export function withReadableLayouts(url: string, versions: readonly number[]): string {
  const withLayouts = new URL(url);
  withLayouts.searchParams.set(READABLE_LAYOUTS_PARAMETER, formatReadableLayouts(versions));
  return withLayouts.toString();
}
