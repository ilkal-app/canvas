// Following a collaborator and the spotlight as a pure state machine: what the local
// camera follows, why, and what to announce, from the user's choices and the presence snapshot.
// The app applies the outcome: it moves the camera to `viewport`, switches to `page`, and
// announces `notice`.
import { computeFollowViewport, type ScreenSize } from './follow-viewport.js';
import type {
  PresenceClientId,
  PresenceSnapshot,
  PresenceState,
  PresenceViewport,
} from './presence-state.js';
import { activeSpotlight, type ActiveSpotlight } from './spotlight.js';

/** Why the local client follows someone: it chose them, or their spotlight took it. */
export type FollowCause = 'chosen' | 'spotlight';

/**
 * What the local camera follows. `optedOutOf` is the start of a spotlight the person stopped
 * following, so that spotlight does not take them again; a newer one does.
 */
export type FollowState =
  | {
      /** Following nobody. */
      readonly kind: 'idle';
      /** The spotlight start the person opted out of, held until a newer one starts. */
      readonly optedOutOf?: number;
    }
  | {
      /** Following a person. */
      readonly kind: 'following';
      /** The followed client. */
      readonly clientId: PresenceClientId;
      /** Who it is, as presence names them. */
      readonly principalId: string;
      /** Their display name, kept to announce them once they have left. */
      readonly name: string;
      /** Why. */
      readonly cause: FollowCause;
      /** The spotlight start the person opted out of, held until a newer one starts. */
      readonly optedOutOf?: number;
    };

/** Following nobody. */
export const IDLE_FOLLOW: FollowState = Object.freeze({ kind: 'idle' });

/** What the state machine reads besides the event. */
export interface FollowContext {
  /** The remote presence now. */
  readonly snapshot: PresenceSnapshot;
  /** The local canvas size, which the followed viewport is fitted to. */
  readonly screen: ScreenSize;
  /** The local client's awareness id. */
  readonly localClientId: PresenceClientId;
  /** The local presence: its page (absent: the first page) and any spotlight it shares. */
  readonly localState?: PresenceState | undefined;
}

/** Why following stopped. */
export type FollowStopReason =
  'escape' | 'camera' | 'button' | 'left' | 'page' | 'unavailable' | 'spotlightEnded';

/** What happened: the person chose someone, stopped, or the presence changed. */
export type FollowEvent =
  | {
      /** The person chose someone to follow. */
      readonly type: 'follow';
      /** Their client. */
      readonly clientId: PresenceClientId;
    }
  | {
      /** The person stopped following. */
      readonly type: 'stop';
      /** How: Esc, their own camera input, or Stop. */
      readonly reason: 'escape' | 'camera' | 'button';
    }
  | {
      /** The presence changed. */
      readonly type: 'presence';
    };

/** What the app announces (in its live region and the chip or toast). */
export type FollowNotice =
  | {
      /** Following someone began. */
      readonly kind: 'started';
      /** Whom. */
      readonly name: string;
    }
  | {
      /** Following someone ended. */
      readonly kind: 'stopped';
      /** Whom. */
      readonly name: string;
      /** Why. */
      readonly reason: FollowStopReason;
    }
  | {
      /** Someone's spotlight took the camera. */
      readonly kind: 'spotlight';
      /** Whose. */
      readonly name: string;
    }
  | {
      /** A newer spotlight replaced another. */
      readonly kind: 'spotlightTakenOver';
      /** Whose spotlight now. */
      readonly name: string;
      /** Whose spotlight before. */
      readonly previous: string;
    }
  | {
      /** The person chosen cannot be followed. */
      readonly kind: 'unavailable';
      /** Whom. */
      readonly name: string;
    };

/** The next state, and what the app does with it. */
export interface FollowOutcome {
  /** The new state. */
  readonly state: FollowState;
  /** The viewport the camera shows, while following someone who shares one. */
  readonly viewport?: PresenceViewport;
  /** The page to switch to: a spotlighter's, when it is not the local one. */
  readonly page?: string;
  /** What to announce, if anything. */
  readonly notice?: FollowNotice;
}

/**
 * A client's name as presence shows it.
 *
 * @param context - The snapshot and the local presence.
 * @param clientId - The client.
 * @returns Its name, or '' when it is gone.
 */
function nameOf(context: FollowContext, clientId: PresenceClientId): string {
  const state =
    context.snapshot.get(clientId) ??
    (clientId === context.localClientId ? context.localState : undefined);
  return state?.principal.name ?? '';
}

/**
 * Whether a remote client shows the local page.
 *
 * @param context - The local presence.
 * @param state - The remote client's presence.
 * @returns True when both show the same page (absent is the first).
 */
function isOnLocalPage(context: FollowContext, state: PresenceState): boolean {
  return state.page === context.localState?.page;
}

/**
 * A state without a stale opt-out: the person's opt-out is kept only while it names a spotlight.
 *
 * @param optedOutOf - The opt-out.
 * @returns The field, or nothing.
 */
function optOut(optedOutOf: number | undefined): { readonly optedOutOf?: number } {
  return optedOutOf === undefined ? {} : { optedOutOf };
}

/**
 * Follows a spotlight: its viewport fitted to the screen, its page when it is not ours.
 *
 * @param context - The snapshot, screen and local presence.
 * @param spotlight - The spotlight.
 * @param notice - What to announce.
 * @returns The outcome.
 */
function followSpotlight(
  context: FollowContext,
  spotlight: ActiveSpotlight,
  notice: FollowNotice | undefined,
): FollowOutcome {
  const target = context.snapshot.get(spotlight.clientId);
  const state: FollowState = {
    kind: 'following',
    clientId: spotlight.clientId,
    principalId: spotlight.principal.id,
    name: spotlight.principal.name,
    cause: 'spotlight',
  };
  const viewport = target?.viewport;
  const page = target === undefined || isOnLocalPage(context, target) ? undefined : target.page;
  return {
    state,
    ...(viewport === undefined
      ? {}
      : { viewport: computeFollowViewport(viewport, context.screen) }),
    ...(page === undefined ? {} : { page }),
    ...(notice === undefined ? {} : { notice }),
  };
}

/**
 * Starts following a chosen person, or says why they cannot be followed: they are gone, are the
 * local client, share no viewport (an agent without one), or show another page.
 *
 * @param state - The state now.
 * @param clientId - The chosen client.
 * @param context - The snapshot, screen and local presence.
 * @returns The outcome.
 */
function follow(
  state: FollowState,
  clientId: PresenceClientId,
  context: FollowContext,
): FollowOutcome {
  const target = context.snapshot.get(clientId);
  const viewport = target?.viewport;
  if (
    target === undefined ||
    clientId === context.localClientId ||
    viewport === undefined ||
    !isOnLocalPage(context, target)
  ) {
    return { state, notice: { kind: 'unavailable', name: nameOf(context, clientId) } };
  }
  // Choosing someone else while a spotlight is on opts out of it, so it does not take them back.
  const spotlight = activeRemoteSpotlight(context);
  const optedOutOf =
    spotlight !== undefined && spotlight.clientId !== clientId ? spotlight.startedAt : undefined;
  return {
    state: {
      kind: 'following',
      clientId,
      principalId: target.principal.id,
      name: target.principal.name,
      cause: 'chosen',
      ...optOut(optedOutOf),
    },
    viewport: computeFollowViewport(viewport, context.screen),
    notice: { kind: 'started', name: target.principal.name },
  };
}

/**
 * The board's spotlight when a remote client shares it (the local one is never followed).
 *
 * @param context - The snapshot and the local presence.
 * @returns The spotlight, or `undefined` when there is none or it is the local client's.
 */
function activeRemoteSpotlight(context: FollowContext): ActiveSpotlight | undefined {
  const local =
    context.localState === undefined
      ? undefined
      : { clientId: context.localClientId, state: context.localState };
  const spotlight = activeSpotlight(context.snapshot, local);
  return spotlight?.clientId === context.localClientId ? undefined : spotlight;
}

/**
 * Re-reads the presence while following or idle: a spotlight takes the camera, an ended one
 * lets it go, and a chosen follow stops when its person leaves, changes page or shares no
 * viewport, else tracks their viewport.
 *
 * @param state - The state now.
 * @param context - The snapshot, screen and local presence.
 * @returns The outcome.
 */
function onPresence(state: FollowState, context: FollowContext): FollowOutcome {
  const spotlight = activeRemoteSpotlight(context);
  const isSpotlightFollow = state.kind === 'following' && state.cause === 'spotlight';
  if (spotlight !== undefined && spotlight.startedAt !== state.optedOutOf) {
    if (isSpotlightFollow && state.clientId === spotlight.clientId) {
      return followSpotlight(context, spotlight, undefined);
    }
    const notice: FollowNotice = isSpotlightFollow
      ? {
          kind: 'spotlightTakenOver',
          name: spotlight.principal.name,
          previous: state.name,
        }
      : { kind: 'spotlight', name: spotlight.principal.name };
    return followSpotlight(context, spotlight, notice);
  }
  if (state.kind === 'idle') return { state };
  const { name } = state;
  const stop = (reason: FollowStopReason): FollowOutcome => ({
    state: { kind: 'idle', ...optOut(state.optedOutOf) },
    notice: { kind: 'stopped', name, reason },
  });
  if (isSpotlightFollow) return stop('spotlightEnded');
  const target = context.snapshot.get(state.clientId);
  if (target === undefined) return stop('left');
  if (!isOnLocalPage(context, target)) return stop('page');
  if (target.viewport === undefined) return stop('unavailable');
  return { state, viewport: computeFollowViewport(target.viewport, context.screen) };
}

/**
 * The follow state machine. Pure: the inputs are never
 * changed.
 *
 * - `follow`: follows a chosen remote person who shares a viewport on the local page
 *   (`computeFollowViewport`), else announces them unavailable.
 * - `stop` (Esc, any camera input, the chip's Stop): stops following; stopping a spotlight's
 *   follow opts out of that spotlight.
 * - `presence`: the newest remote spotlight not opted out of takes the camera (switching page
 *   if need be, announcing it, or who took over); a spotlight follow ends with its spotlight; a
 *   chosen follow ends when its person leaves, changes page or shares no viewport, and otherwise
 *   tracks their viewport.
 *
 * @param state - The state now.
 * @param event - What happened.
 * @param context - The snapshot, the local screen and the local presence.
 * @returns The next state, and the viewport, page and notice the app applies.
 */
export function nextFollow(
  state: FollowState,
  event: FollowEvent,
  context: FollowContext,
): FollowOutcome {
  if (event.type === 'follow') return follow(state, event.clientId, context);
  if (event.type === 'presence') return onPresence(state, context);
  if (state.kind === 'idle') return { state };
  const target = context.snapshot.get(state.clientId);
  const startedAt = target?.spotlight?.startedAt;
  const optedOutOf = state.cause === 'spotlight' ? startedAt : state.optedOutOf;
  return {
    state: { kind: 'idle', ...optOut(optedOutOf) },
    notice: { kind: 'stopped', name: state.name, reason: event.reason },
  };
}
