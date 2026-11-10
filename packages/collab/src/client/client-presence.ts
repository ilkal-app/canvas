import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { DocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { PresenceChannel } from '../presence/presence-channel.js';
import type { PresenceClock, PresenceScheduler } from '../presence/presence-time.js';

import type { BoardTokenClaims } from './board-token.js';
import type { CollabPresenceOptions } from './collab-client-options.js';

/**
 * Creates the awareness a client's connection carries, on a document of its own (the board's
 * store is never written by it) under the store's Yjs client id: a `PresenceClientId` is its
 * document's, so the relay's writer stamp (the client ids it saw a connection write
 * with) and this client's presence name the same id, and a reconnect keeps both.
 *
 * @param store - The board's store.
 * @returns The awareness; destroy its `doc` with it.
 */
export function createClientAwareness(store: DocumentStore): Awareness {
  const document = new Y.Doc();
  document.clientID = store.clientId;
  return new Awareness(document);
}

/**
 * Creates a client's presence channel, stamped with the token's identity: the principal id is
 * the token's `sub` and the kind its `principal`, so collaborators see the identity the relay
 * attributes edits to (the app supplies the colour and a legacy-name fallback). The relay drops a state whose
 * principal id is not the token's `sub` and stamps the kind from the token.
 *
 * @param awareness - The awareness the connection carries.
 * @param claims - The token's claims.
 * @param options - The client's options: its presence settings and its board.
 * @param options.presence - The name, colour, rate and timeout; `undefined` for no presence.
 * @param options.store - The board: a peer's editing claim on an object it does not
 *   hold is not shown, and claims are checked again whenever objects are created or deleted,
 *   until the awareness is destroyed.
 * @param time - The clock and scheduler the channel runs on.
 * @param time.clock - The clock presence stamps states with.
 * @param time.scheduler - Runs the flushes and the timeout sweep.
 * @returns The channel, or `undefined` when presence was not asked for or the token is a demo
 *   board visitor's.
 * @throws {RangeError} When the name, colour, rate or timeout is out of range.
 */
export function createClientPresence(
  awareness: Awareness,
  claims: BoardTokenClaims,
  options: {
    readonly presence?: CollabPresenceOptions | undefined;
    readonly store: Pick<DocumentStore, 'get' | 'subscribe'>;
  },
  time: { readonly clock: PresenceClock; readonly scheduler: PresenceScheduler },
): PresenceChannel | undefined {
  const { presence: settings, store: board } = options;
  // A demo board visitor is never present: the relay drops any presence it sends.
  if (settings === undefined || claims.principalType === 'demo') return undefined;
  const channel = new PresenceChannel({
    awareness,
    principal: {
      id: claims.principalId,
      kind: claims.principalType,
      name: claims.displayName ?? settings.name,
      ...(settings.color === undefined ? {} : { color: settings.color }),
    },
    ...(settings.rateHz === undefined ? {} : { rateHz: settings.rateHz }),
    ...(settings.timeoutMs === undefined ? {} : { timeoutMs: settings.timeoutMs }),
    clock: time.clock,
    scheduler: time.scheduler,
    objectExists: (objectId: string) => board.get(objectId as ObjectId) !== undefined,
  });
  const stop = board.subscribe(({ created, deleted }) => {
    if (created.length > 0 || deleted.length > 0) channel.recheckEditing();
  });
  awareness.once('destroy', stop);
  return channel;
}
