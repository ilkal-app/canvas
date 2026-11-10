import type { ReactionEvent } from '@canvas/schema';

import type { RelayConnectionHost } from './relay-connection-host.js';
import {
  encodeKeepalive,
  encodeTimeRequestMessage,
  type RelayMessage,
  type TokenLifetimeKind,
} from './relay-protocol.js';

/** The relay's stateless messages a connection acts on. */
export type RelayStatelessMessage = Extract<
  RelayMessage,
  {
    readonly kind:
      | 'keepalive'
      | 'threads-changed'
      | 'votes-changed'
      | TokenLifetimeKind
      | 'server-time'
      | 'reaction';
  }
>;

/**
 * Asks the relay's clock, when the client keeps an estimate of it.
 *
 * @param host - The connection's host.
 * @param send - Sends a frame on the socket.
 */
export function askServerTime(
  host: Pick<RelayConnectionHost, 'documentName' | 'serverClock'>,
  send: (data: Uint8Array) => void,
): void {
  const { serverClock, documentName } = host;
  if (serverClock !== undefined)
    send(encodeTimeRequestMessage(documentName, serverClock.request()));
}

/**
 * Hands someone's reaction to the client's channel; a listener that throws is reported, never
 * breaking the connection.
 *
 * @param host - The connection's host.
 * @param event - The reaction.
 */
function receiveReaction(host: RelayConnectionHost, event: ReactionEvent): void {
  try {
    host.reactions?.receive(event);
  } catch (error) {
    host.reportError(error);
  }
}

/**
 * Acts on one of the relay's stateless messages for a connection: answers a keepalive (and asks
 * the relay's clock with it, so the estimate keeps fresh with no timer of its own), hands a
 * thread or vote notice and a reaction of an authenticated connection, the token's lifetime and the relay's clock to
 * the host.
 *
 * @param message - The message.
 * @param host - The connection's host.
 * @param send - Sends a frame on the socket.
 * @param isAuthenticated - Whether the relay has accepted the connection's token.
 */
export function receiveStateless(
  message: RelayStatelessMessage,
  host: RelayConnectionHost,
  send: (data: Uint8Array) => void,
  isAuthenticated: boolean,
): void {
  switch (message.kind) {
    case 'keepalive':
      send(encodeKeepalive(host.documentName));
      askServerTime(host, send);
      return;
    case 'threads-changed':
      if (isAuthenticated) host.onThreadsChanged?.();
      return;
    case 'votes-changed':
      if (isAuthenticated) host.onVotesChanged?.();
      return;
    case 'server-time':
      host.serverClock?.receive(message.id, message.nowMs);
      return;
    case 'reaction':
      if (isAuthenticated) receiveReaction(host, message.event);
      return;
    case 'token-expiry':
    case 'token-refreshed':
      host.onTokenLifetime?.(message.kind, message.expiresInMs);
      return;
  }
}
