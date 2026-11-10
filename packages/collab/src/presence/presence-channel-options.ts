import type { Awareness } from 'y-protocols/awareness';

import { colorForPrincipal } from './presence-color.js';
import { isPresencePrincipal } from './presence-guard.js';
import { MAX_PRESENCE_TEXT_LENGTH } from './presence-limits.js';
import { cleanPresenceName } from './presence-names.js';
import type { PresencePrincipal, PrincipalKind } from './presence-state.js';
import type { PresenceClock, PresenceScheduler } from './presence-time.js';

/**
 * The longest presence timeout, in ms: y-protocols' `outdatedTimeout`. Awareness removes a
 * silent peer after 30 s on its own wall-clock interval whatever the channel says, so a longer
 * channel timeout would be a promise nobody keeps.
 */
export const MAX_PRESENCE_TIMEOUT_MS = 30_000;

/**
 * The shortest presence timeout, in ms. y-protocols renews every client's state once it is
 * 15 s old, checking every 3 s, so an idle peer can be silent for up to 18 s; a timeout of at
 * least 20 s never removes a connected peer, whatever timeout that peer runs.
 */
export const MIN_PRESENCE_TIMEOUT_MS = 20_000;

/** How long a silent client stays in presence by default, in ms: {@link MAX_PRESENCE_TIMEOUT_MS}. */
export const DEFAULT_PRESENCE_TIMEOUT_MS = MAX_PRESENCE_TIMEOUT_MS;

/** Who the local client is; the colour defaults to {@link colorForPrincipal} of the id. */
export interface PresencePrincipalInput {
  /** The user's or agent's id. */
  readonly id: string;
  /** Whether the principal is a person or an agent. */
  readonly kind: PrincipalKind;
  /** The display name. */
  readonly name: string;
  /** The colour, `#rrggbb`; omitted to derive it from the id. */
  readonly color?: string;
}

/** What a `PresenceChannel` is built from. */
export interface PresenceChannelOptions {
  /** The awareness instance the provider syncs; the channel is its only local writer. */
  readonly awareness: Awareness;
  /** Who the local client is. */
  readonly principal: PresencePrincipalInput;
  /** Outbound updates per second, 20 to 30 Hz; default `DEFAULT_PRESENCE_RATE_HZ`. */
  readonly rateHz?: number;
  /**
   * How long a silent remote client stays before this channel removes it, in ms, from
   * {@link MIN_PRESENCE_TIMEOUT_MS} (20 s) to {@link MAX_PRESENCE_TIMEOUT_MS} (30 s, where
   * y-protocols' own clean-up caps it); default {@link DEFAULT_PRESENCE_TIMEOUT_MS}. Use the
   * same value on every client of a board, so they agree on when a peer has left. Any value in
   * the range is safe against any peer: y-protocols renews each state at most 18 s apart.
   */
  readonly timeoutMs?: number;
  /** The clock; default `Date.now`. */
  readonly clock?: PresenceClock;
  /**
   * Runs deferred work: the trailing outbound flush, the inbound flush (delay 0; inject a
   * frame scheduler to land snapshots once per frame) and the timeout sweep. Default
   * `setTimeout`.
   */
  readonly scheduler?: PresenceScheduler;
  /**
   * Whether the board holds an object: a remote client's editing claim on an object it
   * does not hold is dropped from that client's presence, the rest of which stays. Claims are
   * checked as states arrive and on `PresenceChannel.recheckEditing`. Every claim is
   * shown if absent.
   */
  readonly objectExists?: (objectId: string) => boolean;
}

/**
 * Checks and completes the local principal: a clean name and, when none is given, the id's colour.
 *
 * @param input - The principal as given.
 * @returns The principal presence sends.
 * @throws {RangeError} When the principal is malformed.
 */
export function resolvePresencePrincipal(input: PresencePrincipalInput): PresencePrincipal {
  const principal = {
    id: input.id,
    kind: input.kind,
    name: cleanPresenceName(input.name),
    color: input.color ?? colorForPrincipal(input.id),
  };
  if (!isPresencePrincipal(principal)) {
    throw new RangeError(
      'A presence principal needs a non-empty id of at most ' +
        `${String(MAX_PRESENCE_TEXT_LENGTH)} characters, a kind of user or agent, a name and a ` +
        '#rrggbb colour.',
    );
  }
  return principal;
}
