// Spotlight: an editor or the owner asks everyone else on the board to follow them.
// It is presence only (a `spotlight` field in awareness), never written to
// the document; the newest one wins.
import type {
  PresenceClientId,
  PresencePrincipal,
  PresenceSnapshot,
  PresenceState,
} from './presence-state.js';
import { isValidSpotlight } from './presence-validation.js';

/** The board's active spotlight: who shares it and when they started. */
export interface ActiveSpotlight {
  /** The spotlighting client. */
  readonly clientId: PresenceClientId;
  /** Who it is. */
  readonly principal: PresencePrincipal;
  /** When it started, in ms on its sender's clock. */
  readonly startedAt: number;
}

/** The local client, for the spotlight it may share itself. */
export interface LocalPresence {
  /** Its awareness client id. */
  readonly clientId: PresenceClientId;
  /** Its presence. */
  readonly state: PresenceState;
}

/**
 * Whether one spotlight wins over another: the newer, or on a tie the smaller client id, so
 * every client picks the same one.
 *
 * @param challenger - The candidate.
 * @param holder - The one it would replace.
 * @returns True when the candidate wins.
 */
function isNewer(challenger: ActiveSpotlight, holder: ActiveSpotlight): boolean {
  return (
    challenger.startedAt > holder.startedAt ||
    (challenger.startedAt === holder.startedAt && challenger.clientId < holder.clientId)
  );
}

/**
 * The spotlight the board shows: among the remote clients and the local one, the
 * valid spotlight started last; a tie goes to the smaller client id. Pure.
 *
 * @param snapshot - The remote presence.
 * @param local - The local client and its presence, which may share a spotlight too.
 * @returns The spotlight, or `undefined` when nobody shares one.
 */
export function activeSpotlight(
  snapshot: PresenceSnapshot,
  local?: LocalPresence,
): ActiveSpotlight | undefined {
  let winner: ActiveSpotlight | undefined;
  const consider = (clientId: PresenceClientId, state: PresenceState) => {
    if (!isValidSpotlight(state.spotlight)) return;
    const candidate = {
      clientId,
      principal: state.principal,
      startedAt: state.spotlight.startedAt,
    };
    if (winner === undefined || isNewer(candidate, winner)) winner = candidate;
  };
  for (const [clientId, state] of snapshot) consider(clientId, state);
  if (local !== undefined) consider(local.clientId, local.state);
  return winner;
}

/**
 * Whether the local spotlight has been replaced by a newer one, so the local client
 * should clear its own: a remote spotlight started later, or at the same time from a smaller
 * client id. Pure.
 *
 * @param local - The local presence.
 * @param snapshot - The remote presence.
 * @param localClientId - The local client's id, for a tie.
 * @returns True when the local client shares a spotlight that no longer wins.
 */
export function isSpotlightSuperseded(
  local: PresenceState,
  snapshot: PresenceSnapshot,
  localClientId: PresenceClientId,
): boolean {
  if (!isValidSpotlight(local.spotlight)) return false;
  const remote = activeSpotlight(snapshot);
  const own = { clientId: localClientId, principal: local.principal, ...local.spotlight };
  return remote !== undefined && isNewer(remote, own);
}

/** A member's role on a board, as presence rules read it. */
export type SpotlightRole = 'owner' | 'editor' | 'commenter' | 'viewer';

/**
 * Whether a role may start a spotlight: the owner and editors; viewers and commenters
 * can be spotlighted but not start one (the relay drops theirs).
 *
 * @param role - The member's role.
 * @returns True for the owner and editors.
 */
export function canSpotlight(role: SpotlightRole): boolean {
  return role === 'owner' || role === 'editor';
}
