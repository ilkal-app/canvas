import {
  activeSpotlight,
  colorForPrincipal,
  IDLE_FOLLOW,
  isSpotlightSuperseded,
  nextFollow,
  type FollowEvent,
  type FollowNotice,
  type FollowOutcome,
  type FollowState,
  type PresenceClientId,
  type PresencePrincipal,
  type PresenceSnapshot,
  type PresenceSpotlight,
  type PresenceState,
  type PresenceViewport,
  type ScreenSize,
} from '@canvas/collab';

/** What the follow controller reads and drives; the shell wires it to the board. */
export interface FollowHost {
  /** The remote presence now. */
  remote(): PresenceSnapshot;
  /** The local client and its presence, or `undefined` where there is no presence. */
  local(): { readonly clientId: PresenceClientId; readonly state: PresenceState } | undefined;
  /**
   * Calls back whenever presence changes.
   *
   * @param listener - Called with no arguments.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Shares a spotlight in the local presence, or ends it.
   *
   * @param spotlight - The spotlight, or `null`.
   */
  showSpotlight(spotlight: PresenceSpotlight | null): void;
  /**
   * Tells collaborators whom the person follows, or that they follow nobody (presence
   * `following`), so a spotlighter can count their followers.
   *
   * @param principalId - Who, or `null`.
   */
  showFollowing(principalId: string | null): void;
  /** The local canvas size, or `undefined` before it is laid out. */
  screen(): ScreenSize | undefined;
  /**
   * Moves the camera to show a region, as the follow does (never reported as camera input).
   *
   * @param viewport - The region, fitted to the screen.
   */
  showViewport(viewport: PresenceViewport): void;
  /**
   * Shows another page (a spotlighter's).
   *
   * @param pageId - The page.
   */
  showPage(pageId: string): void;
  /**
   * Says something in the live region, and shows it as a toast when asked.
   *
   * @param message - The words.
   * @param isToast - Whether to show it as a toast too (a spotlight starting, taking over).
   */
  announce(message: string, isToast: boolean): void;
  /** The local clock, ms. */
  now(): number;
  /** Whether the person may start a spotlight: an owner or editor (`canSpotlight`). */
  canSpotlight(): boolean;
}

/** What the presence bar and the follow frame show. */
export interface FollowView {
  /** What the local camera follows. */
  readonly follow: FollowState;
  /** Whether the local client shares the spotlight. */
  readonly isSpotlighting: boolean;
  /** How many people follow the local spotlight, while spotlighting (presence `following`). */
  readonly audience: number;
  /** Whether the person may start a spotlight. */
  readonly canSpotlight: boolean;
}

/**
 * The words a follow notice says, for the live region and the toasts.
 *
 * @param notice - The notice.
 * @returns The message.
 */
export function followMessageOf(notice: FollowNotice): string {
  switch (notice.kind) {
    case 'started':
      return `Following ${notice.name}.`;
    case 'spotlight':
      return `${notice.name} started a spotlight. You're following ${notice.name}'s view.`;
    case 'spotlightTakenOver':
      return `${notice.name} took over the spotlight from ${notice.previous}.`;
    case 'unavailable':
      return notice.name === ''
        ? 'That person has left.'
        : `${notice.name} has no view to follow yet.`;
    case 'stopped':
      switch (notice.reason) {
        case 'left':
          return `${notice.name} left. Stopped following.`;
        case 'page':
          return `${notice.name} went to another page. Stopped following.`;
        case 'spotlightEnded':
          return `${notice.name}'s spotlight ended.`;
        default:
          return `Stopped following ${notice.name}.`;
      }
  }
}

/**
 * Whether a notice is worth a toast as well as the live region: the spotlight's, which nobody
 * asked for.
 *
 * @param notice - The notice.
 * @returns True for a spotlight starting or taking over.
 */
function isToastNotice(notice: FollowNotice): boolean {
  return notice.kind === 'spotlight' || notice.kind === 'spotlightTakenOver';
}

/**
 * Following a collaborator and the spotlight in the app: runs `nextFollow` on every
 * presence change and on the person's choices, moves the camera and the page as it says,
 * announces what happens, shares and ends the local spotlight, and clears it when a newer one
 * takes over. Main thread.
 */
export class FollowController {
  #state: FollowState = IDLE_FOLLOW;
  #view: FollowView = {
    follow: IDLE_FOLLOW,
    isSpotlighting: false,
    audience: 0,
    canSpotlight: false,
  };
  readonly #listeners = new Set<() => void>();
  readonly #stop: () => void;

  /**
   * Starts following presence.
   *
   * @param host - The board's presence, camera, page and announcer.
   */
  constructor(private readonly host: FollowHost) {
    this.#stop = host.subscribe(() => {
      this.#onPresence();
    });
    this.#onPresence();
  }

  /**
   * What the bar and the frame show now; a new object only when it changes.
   *
   * @returns The view.
   */
  view(): FollowView {
    return this.#view;
  }

  /**
   * Calls back when the view changes.
   *
   * @param listener - Called with no arguments.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Follows a person (the avatar menu's Follow, or a double-click on the avatar): their newest
   * client that shares a viewport on the local page; else their newest client, which the follow
   * then announces as unavailable.
   *
   * @param principalId - Who.
   */
  follow(principalId: string): void {
    const clients = [...this.host.remote()]
      .filter(([, state]) => state.principal.id === principalId)
      .sort(([, first], [, second]) => second.updatedAt - first.updatedAt);
    const [chosen] = [...clients.filter(([, state]) => this.#isFollowable(state)), ...clients];
    this.#run({ type: 'follow', clientId: chosen?.[0] ?? -1 });
  }

  /**
   * Whether a person can be followed now: one of their clients shares a viewport on the local
   * page (an agent with none cannot, frame F7).
   *
   * @param principalId - Who.
   * @returns True when Follow would follow them.
   */
  canFollow(principalId: string): boolean {
    for (const state of this.host.remote().values()) {
      if (state.principal.id === principalId && this.#isFollowable(state)) return true;
    }
    return false;
  }

  /**
   * Who the local person is on the board (their presence principal), for the people sheet's own
   * row (frame P2).
   *
   * @returns The principal, or `undefined` before presence starts.
   */
  self(): PresencePrincipal | undefined {
    return this.host.local()?.state.principal;
  }

  /**
   * A person's presence colour, for the follow frame: their colourway's dark, derived from their id
   * as every view does.
   *
   * @param principalId - Who.
   * @returns Their colour, `#rrggbb`, or `undefined` when they are gone or have none.
   */
  colorOf(principalId: string): string | undefined {
    for (const state of this.host.remote().values()) {
      if (state.principal.id === principalId) return colorForPrincipal(principalId);
    }
    return undefined;
  }

  /**
   * Stops following (Esc, any camera input of the person's, the chip's Stop); nothing while not
   * following.
   *
   * @param reason - Why.
   */
  stop(reason: 'escape' | 'camera' | 'button'): void {
    if (this.#state.kind === 'idle') return;
    this.#run({ type: 'stop', reason });
  }

  /**
   * Shares the spotlight: everyone else follows the local view. It starts later than any spotlight
   * already shared, so it takes over even from a sender whose clock runs ahead. At the largest
   * valid start time a tie goes to the smaller client id: a start that would lose it is not
   * shared, and the person is told who holds the spotlight.
   */
  startSpotlight(): void {
    if (!this.host.canSpotlight()) return;
    let latest = 0;
    for (const state of this.host.remote().values()) {
      latest = Math.max(latest, state.spotlight?.startedAt ?? 0);
    }
    const spotlight = {
      startedAt: Math.min(Math.max(this.host.now(), latest + 1), Number.MAX_SAFE_INTEGER),
    };
    const local = this.host.local();
    const winner =
      local === undefined
        ? undefined
        : activeSpotlight(this.host.remote(), {
            clientId: local.clientId,
            state: { ...local.state, spotlight },
          });
    if (winner !== undefined && local !== undefined && winner.clientId !== local.clientId) {
      this.host.announce(`${winner.principal.name} holds the spotlight.`, true);
      this.#refresh();
      return;
    }
    this.stop('button');
    this.host.showSpotlight(spotlight);
    this.host.announce("You're spotlighting. Everyone here follows your view.", false);
    this.#refresh();
  }

  /** Ends the local spotlight; nothing when it shares none. */
  endSpotlight(): void {
    if (!this.#isSpotlighting()) return;
    this.host.showSpotlight(null);
    this.host.announce('Spotlight ended.', false);
    this.#refresh();
  }

  /** Stops following presence; the local spotlight ends with the page. */
  destroy(): void {
    this.#stop();
    this.#listeners.clear();
  }

  #isFollowable(state: PresenceState): boolean {
    return state.viewport !== undefined && state.page === this.host.local()?.state.page;
  }

  #isSpotlighting(): boolean {
    return this.host.local()?.state.spotlight !== undefined;
  }

  #onPresence(): void {
    const local = this.host.local();
    const remote = this.host.remote();
    // A newer spotlight replaces the local one: clear it, and say who took over.
    if (local !== undefined && isSpotlightSuperseded(local.state, remote, local.clientId)) {
      this.host.showSpotlight(null);
      const winner = activeSpotlight(remote);
      if (winner !== undefined)
        this.host.announce(`${winner.principal.name} took over the spotlight.`, true);
    }
    this.#run({ type: 'presence' });
  }

  #run(event: FollowEvent): void {
    const screen = this.host.screen();
    const local = this.host.local();
    // Before the camera reports a screen nothing can be followed, but the view still updates
    // (Spotlight me depends on the role, not the screen).
    if (screen === undefined) {
      this.#refresh();
      return;
    }
    const outcome: FollowOutcome = nextFollow(this.#state, event, {
      snapshot: this.host.remote(),
      screen,
      localClientId: local?.clientId ?? -1,
      localState: local?.state,
    });
    const followed = this.#state.kind === 'following' ? this.#state.principalId : null;
    this.#state = outcome.state;
    const following = outcome.state.kind === 'following' ? outcome.state.principalId : null;
    if (following !== followed) this.host.showFollowing(following);
    if (outcome.page !== undefined) this.host.showPage(outcome.page);
    if (outcome.viewport !== undefined) this.host.showViewport(outcome.viewport);
    if (outcome.notice !== undefined) {
      this.host.announce(followMessageOf(outcome.notice), isToastNotice(outcome.notice));
    }
    this.#refresh();
  }

  #refresh(): void {
    const isSpotlighting = this.#isSpotlighting();
    const canSpotlight = this.host.canSpotlight();
    const me = this.host.local()?.state.principal.id;
    const audience = isSpotlighting
      ? [...this.host.remote().values()].filter((state) => state.following === me).length
      : 0;
    const view = this.#view;
    if (
      view.follow === this.#state &&
      view.isSpotlighting === isSpotlighting &&
      view.audience === audience &&
      view.canSpotlight === canSpotlight
    )
      return;
    this.#view = { follow: this.#state, isSpotlighting, audience, canSpotlight };
    for (const listener of [...this.#listeners]) listener();
  }
}
