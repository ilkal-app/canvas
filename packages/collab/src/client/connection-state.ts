/**
 * Where a collab client stands with the relay, as the app shows it:
 *
 * - `connecting`: the first attempt since the client started or came back online;
 * - `connected`: authenticated, and the relay's state has arrived (the first sync is done);
 * - `reconnecting`: an attempt failed or the connection dropped; retrying with backoff;
 * - `offline`: not trying, because the network is down or the app called `disconnect()`;
 * - `unauthorized`: the relay refused the token, and a fresh one if the token provider had one;
 *   the client does not retry.
 * - `outdated`: this build cannot read the board's stored layout: the relay's layout
 *   gate refused it (close code 4426), or the store refused the relay's data
 *   (`DocumentVersionError`). The client does not retry: the app must be reloaded.
 *
 * Local edits are accepted in every state and reach the relay on the next sync; once
 * `unauthorized` or `outdated` there is no next sync, and they stay in the store and the cache.
 */
export const CONNECTION_STATES = [
  'connecting',
  'connected',
  'reconnecting',
  'offline',
  'unauthorized',
  'outdated',
] as const;

/** One of {@link CONNECTION_STATES}. */
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * What happens to a connection: an attempt starts, the first sync completes, the connection is
 * lost (or an attempt fails), the relay refuses the token, the build turns out unable to read
 * the board (`outdated`), or the client goes offline or comes back online.
 */
export const CONNECTION_EVENTS = [
  'attempt',
  'synced',
  'lost',
  'rejected',
  'outdated',
  'offline',
  'online',
] as const;

/** One of {@link CONNECTION_EVENTS}. */
export type ConnectionEvent = (typeof CONNECTION_EVENTS)[number];

/**
 * The connection state machine. `unauthorized` is terminal: the client reaches it only once a
 * fresh token was refused too (or the provider had none), so the app signs the user in again
 * and creates a new client. `outdated` is terminal too, from any state: no retry can make this
 * build read the board, so the app is reloaded. `offline` ignores everything but `online`,
 * which starts a fresh first attempt. Otherwise a sync connects, a loss reconnects, and an
 * attempt keeps the state it starts from.
 *
 * @param state - The current state.
 * @param event - What happened.
 * @returns The next state; `state` itself when the event changes nothing.
 */
export function nextConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (state === 'unauthorized' || state === 'outdated') return state;
  if (event === 'rejected') return 'unauthorized';
  if (event === 'outdated') return 'outdated';
  if (state === 'offline') return event === 'online' ? 'connecting' : state;
  switch (event) {
    case 'offline':
      return 'offline';
    case 'synced':
      return 'connected';
    case 'lost':
      return 'reconnecting';
    case 'attempt':
    case 'online':
      return state;
  }
}
