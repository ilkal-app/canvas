import type { Point } from '@canvas/schema';

import { createApiTransport } from '../service/api-transport.js';

/** A message returned by the comments service. */
export interface Message {
  /** Stable identifier. */
  readonly id: string;
  /** Who wrote it: a person, or an agent for its operator; a person when absent. */
  readonly authorKind?: 'user' | 'agent' | 'guest';
  /** Author's user id; null for an agent's message. */
  readonly authorId: string | null;
  /** Author's display name: the person's, or the agent's key or app name. */
  readonly authorName: string;
  /** The person an agent wrote it for; null or absent for a person's message. */
  readonly operatorId?: string | null;
  /** That operator's display name; null or absent for a person's message. */
  readonly operatorName?: string | null;
  /** Plain text. */
  readonly text: string;
  /** Mentioned user ids. */
  readonly mentions: readonly string[];
  /** ISO creation time. */
  readonly createdAt: string;
}
/** A relational thread, anchored by a document pin. */
export interface Thread {
  /** Stable identifier. */
  readonly id: string;
  /** Document pin id. */
  readonly pinId: string;
  /** Whether it is resolved. */
  readonly isResolved: boolean;
  /**
   * Who started it, as the service records it: the person, or the operator of the agent
   * that did; null or absent when it is not known.
   */
  readonly starterId?: string | null;
  /** Messages in creation order. */
  readonly messages: readonly Message[];
  /**
   * When the signed-in person last read it: their own read mark, null before they read
   * it; absent from a service older than read marks, where nothing counts as unread.
   */
  readonly lastReadAt?: string | null;
  /**
   * Where its pin shows, kept with the thread in the service; null or absent while its
   * pin is still a document object, not yet adopted (`useAdoptPins`).
   */
  readonly pin?: ThreadPin | null;
}

/** What a thread's pin is attached to: a board point, or an object at an offset in its frame. */
export type ThreadPinAnchor =
  | {
      /** A pin at its own point. */
      readonly kind: 'point';
    }
  | {
      /** A pin that follows an object. */
      readonly kind: 'object';
      /** The object's id in the board document. */
      readonly objectId: string;
      /** The pin's offset in the object's frame. */
      readonly offset: Point;
    };

/** A thread's pin as the service keeps it. */
export interface ThreadPin {
  /** The page it shows on. */
  readonly pageId: string;
  /** What it is attached to. */
  readonly anchor: ThreadPinAnchor;
  /** Its board point, or an object pin's spot while its object is gone or on another page. */
  readonly point: Point;
}

/** Where a guest's board token comes from, per board. */
const GUEST_BEARERS = new Map<string, () => Promise<string>>();

/**
 * The comment calls a guest makes with its board token, as the service's board-token
 * comment routes take them: the list, starting a thread, replying, resolving, reopening, deleting
 * and restoring. A guest's other calls (moving a pin, read marks) are not sent: the service keeps
 * them for people with an account.
 */
const GUEST_CALLS: readonly RegExp[] = [
  /^GET $/,
  /^POST $/,
  /^POST \/[^/]+\/(messages|resolve|reopen|restore)$/,
  /^DELETE \/[^/]+(\/messages\/[^/]+)?$/,
];

/**
 * Sends a board's comment calls with a guest's board token rather than a session,
 * until the returned function stops it: the guest's board page, while it is open.
 *
 * @param boardId - The guest's board.
 * @param bearer - Gives a board token for it.
 * @returns Stops it.
 */
export function authorizeCommentsAsGuest(
  boardId: string,
  bearer: () => Promise<string>,
): () => void {
  GUEST_BEARERS.set(boardId, bearer);
  return () => {
    if (GUEST_BEARERS.get(boardId) === bearer) GUEST_BEARERS.delete(boardId);
  };
}

/**
 * Calls the guarded same-origin comment routes through the site's transport: with the session,
 * or for a guest's board (`authorizeCommentsAsGuest`) with its board token, a call the token
 * routes do not take answering nothing without being sent.
 *
 * @param boardId - Board identifier.
 * @param method - HTTP verb.
 * @param suffix - Encoded subpath after threads.
 * @param body - Optional JSON body.
 * @returns The decoded answer.
 */
export async function commentRequest(
  boardId: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  suffix = '',
  body?: unknown,
): Promise<{ threads?: Thread[]; thread?: Thread }> {
  const bearer = GUEST_BEARERS.get(boardId);
  if (bearer !== undefined && !GUEST_CALLS.some((call) => call.test(`${method} ${suffix}`))) {
    return {};
  }
  return createApiTransport()({
    method,
    path: `/api/boards/${encodeURIComponent(boardId)}/threads${suffix}`,
    ...(body === undefined ? {} : { body }),
    ...(bearer === undefined ? {} : { bearer: await bearer() }),
    read: (value) => (value ?? {}) as { threads?: Thread[]; thread?: Thread },
  });
}
