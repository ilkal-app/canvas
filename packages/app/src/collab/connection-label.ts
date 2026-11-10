import { UPDATE_TOO_LARGE_REASON, type ConnectionState } from '@canvas/collab';
import {
  UPDATE_DEPTH_REASON,
  UPDATE_MALFORMED_REASON,
  type DocumentVersionProblem,
} from '@canvas/document';

import type { BoardConnectionStatus } from './board-connection-status.js';

/** What the connection's state says: a short label and a longer detail for its tooltip. */
export interface ConnectionDescription {
  /** The label shown, e.g. `Connected · 1 other`. */
  readonly label: string;
  /** The board, who else is on it, unsent edits and a refusal's reason. */
  readonly detail: string;
}

const STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  unauthorized: 'Not authorized',
  outdated: 'App out of date: reload the page',
};

/** The detail of an outdated app: why, what to do, and where edits went. */
const OUTDATED_DETAIL =
  'This version of the app cannot read this board. Reload the page to get the new version; ' +
  'until then editing is off and nothing is sent';

/**
 * The store's problem when a peer wrote objects without a layout stamp: the board holds data
 * no build can trust, so the app is not what is out of date and reloading does not help.
 */
const UNTRUSTED_DATA: DocumentVersionProblem = 'unversioned';

/** The label while the board holds data this app cannot trust (fix round 1). */
const UNTRUSTED_LABEL = 'This board cannot be opened safely right now';

/** The label when the relay refused a change too large to sync. */
const TOO_LARGE_LABEL = 'A change is too large to sync';

/**
 * The detail when the relay refused a change too large to sync: one piece of it (a text over
 * 8 MiB) is larger than the server accepts and cannot be split.
 */
const TOO_LARGE_DETAIL =
  'A change on this board is larger than the server accepts in one piece (over 8 MiB of text) ' +
  'and cannot be split, so it was not sent; it stays on this device, and syncing has stopped';

/** The refusal reason of a board whose session ended while it was open. */
export const SESSION_ENDED_REASON = 'session-ended';

/** The label of a board whose session ended while it was open. */
const SESSION_ENDED_LABEL = 'Session ended';

/** The detail of a board whose session ended: what to do (no claim about its edits). */
const SESSION_ENDED_DETAIL = 'Sign in again to keep editing';

/** The detail while the board holds data this app cannot trust. */
const UNTRUSTED_DETAIL =
  'The board holds changes this app cannot trust, and reloading will not help; ' +
  'until they are fixed, editing is off and nothing is sent';

/**
 * The label of a board only on this device: whether its edits survive a reload.
 *
 * @param status - A local-only board's status.
 * @returns `Offline · local board`, or `Offline · not saved` when it lives only in memory.
 */
function localLabel(status: BoardConnectionStatus): string {
  return status.isSavedOnDevice ? 'Offline · local board' : 'Offline · not saved';
}

/** How many collaborators the tooltip names; the rest are counted (a board can have hundreds). */
const MAX_NAMED_COLLABORATORS = 5;

/** The longest refusal reason the tooltip shows. */
const MAX_REASON_LENGTH = 200;

/**
 * A refusal's reason, cut to a length a tooltip can hold: the reason is text the relay sent.
 *
 * @param reason - The reason.
 * @returns The reason, with an ellipsis when it was cut (never inside a surrogate pair).
 */
function boundedReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) return reason;
  const last = reason.charCodeAt(MAX_REASON_LENGTH - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return `${reason.slice(0, MAX_REASON_LENGTH - (isHighSurrogate ? 1 : 0))}…`;
}

/**
 * Describes where the board stands for the presence/share bar: the state,
 * `Offline · local board` for a board only on this device (`Offline · not saved` when it cannot be
 * kept there), `App out of date: reload the page` when this build cannot read the board,
 * `This board cannot be opened safely right now` when the board holds data no build
 * can trust (the store's `unversioned` problem, or the relay's `update-depth-exceeded` or
 * `update-malformed`: plain values nested past the bound, or bytes it could not read), `A change is too large to sync` when the relay refused a change too large to split
 * (`update-too-large`), `Session ended` for a board whose session ended while it was
 * open ({@link SESSION_ENDED_REASON}), and while connected how many others are on the board; the detail names
 * the first five collaborators and how many more there are, edits the relay has not acknowledged, what an outdated app should do and why
 * the relay refused. Pure.
 *
 * Each named collaborator says the page they show, when `pageNameOf` names it.
 *
 * @param status - The connection's status.
 * @param pageNameOf - A page's name, from its id; none if absent.
 * @returns The label and the detail.
 */
export function describeConnection(
  status: BoardConnectionStatus,
  pageNameOf?: (pageId: string) => string | undefined,
): ConnectionDescription {
  const others = status.collaborators.length;
  const isUntrusted =
    status.state === 'outdated' &&
    (status.rejectionReason === UNTRUSTED_DATA ||
      status.rejectionReason === UPDATE_DEPTH_REASON ||
      status.rejectionReason === UPDATE_MALFORMED_REASON);
  const isTooLarge =
    status.state === 'outdated' && status.rejectionReason === UPDATE_TOO_LARGE_REASON;
  let label = status.isLocalOnly ? localLabel(status) : STATE_LABELS[status.state];
  if (isUntrusted) label = UNTRUSTED_LABEL;
  if (isTooLarge) label = TOO_LARGE_LABEL;
  const isSessionEnded =
    status.state === 'unauthorized' && status.rejectionReason === SESSION_ENDED_REASON;
  if (isSessionEnded) label = SESSION_ENDED_LABEL;
  if (status.state === 'connected' && others > 0) {
    label += ` · ${String(others)} ${others === 1 ? 'other' : 'others'}`;
  }
  // Never the board's id: an id is no name to show a person (item 8).
  const details: string[] = [];
  if (others > 0) {
    const named = status.collaborators.slice(0, MAX_NAMED_COLLABORATORS).map((peer) => {
      const page = peer.page === undefined ? undefined : pageNameOf?.(peer.page);
      return page === undefined ? peer.name : `${peer.name} (on ${page})`;
    });
    const rest = others - named.length;
    details.push(`with ${named.join(', ')}${rest > 0 ? ` and ${String(rest)} more` : ''}`);
  }
  if (isTooLarge) details.push(TOO_LARGE_DETAIL);
  else if (status.state === 'outdated') {
    details.push(isUntrusted ? UNTRUSTED_DETAIL : OUTDATED_DETAIL);
  }
  if (status.pendingUpdateCount > 0) {
    details.push(`${String(status.pendingUpdateCount)} edits not yet sent`);
  }
  if (isSessionEnded) details.push(SESSION_ENDED_DETAIL);
  else if (status.rejectionReason !== undefined) {
    details.push(`refused: ${boundedReason(status.rejectionReason)}`);
  }
  return { label, detail: details.join(' · ') };
}

/**
 * What the presence/share bar shows of the connection (the design's board frame): `Live` while
 * connected to the relay (the avatars beside it say who else is here), `Connecting` while the
 * live board loads (the progress line and the board-name bar's subtitle say
 * the rest), `Reconnecting` while a synced board's connection was dropped and comes back by
 * itself (the offline banner then says the connection dropped), otherwise the label of
 * {@link describeConnection} (`Offline · local board`, `Session ended`, `App out of date: reload the page`, …), with ` · read-only` after it for a
 * person who may only look at the board. The full label stays the state's accessible name. Pure.
 *
 * @param status - The connection's status.
 * @returns The text shown.
 */
export function shortConnectionLabel(status: BoardConnectionStatus): string {
  const isLive = status.state === 'connected' && !status.isLocalOnly;
  let shown = describeConnection(status).label;
  if (isLive) shown = 'Live';
  else if (isLoadingLiveBoard(status)) shown = 'Connecting';
  else if (status.state === 'reconnecting' && !status.isLocalOnly) shown = 'Reconnecting';
  return status.isReadOnly ? `${shown} · read-only` : shown;
}

/** The board-name bar's subtitle while the live board loads. */
export const LOADING_LIVE_BOARD_SUBTITLE = 'Saved copy · loading the live board…';

/** What the offline banner says, before its Retry now. */
export const OFFLINE_BANNER_MESSAGE =
  'You’re offline. Edits are kept on this device and sync when you reconnect.';

/**
 * What the banner says when the relay refused or dropped the connection and the client will
 * reconnect by itself (item 6), before its Retry now.
 */
export const CONNECTION_DROPPED_MESSAGE = 'Connection dropped. Reconnecting…';

/**
 * Whether the live board is loading: a synced board's connection is
 * `connecting`, while the device's copy shows. The board-name bar's subtitle then reads
 * {@link LOADING_LIVE_BOARD_SUBTITLE}, the presence bar `Connecting`, and a progress line runs
 * along the top edge; all three go when the live board is in. It follows the connection's state
 * until's swap of the saved copy for the live board lands. Pure.
 *
 * @param status - The connection's status.
 * @returns True while a synced board connects.
 */
export function isLoadingLiveBoard(status: BoardConnectionStatus): boolean {
  return status.state === 'connecting' && !status.isLocalOnly;
}

/**
 * Whether the board is away from the relay and will sync when it is back: a
 * synced board's connection is `offline` (the device is) or `reconnecting` (the relay is out of
 * reach), so edits stay on the device until it reconnects. The offline banner then shows, with
 * Retry now, and the people last seen on the board are dimmed. Not for a local-only board, which
 * never syncs, nor once the relay refused the client for good. Pure.
 *
 * @param status - The connection's status.
 * @returns True while a synced board is offline or reconnecting.
 */
export function isAwayFromRelay(status: BoardConnectionStatus): boolean {
  return (status.state === 'offline' || status.state === 'reconnecting') && !status.isLocalOnly;
}
