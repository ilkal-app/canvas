import type {
  BoardTokenClaims,
  BoardTokenRole,
  CollabClientOptions,
  CollabStatus,
  CollabStatusListener,
  ConnectionState,
  PresenceListener,
  PresenceSnapshot,
  PresenceState,
} from '@canvas/collab';

import type { BoardSyncClient, StrandedEditsSource } from '../board-connection.js';

/** A collab client the test drives: its status and remote presence change on command. */
export class FakeSyncClient implements BoardSyncClient {
  readonly claims: BoardTokenClaims;
  status: CollabStatus = {
    state: 'connecting',
    lastSyncedAt: undefined,
    pendingUpdateCount: 0,
    isReadOnly: false,
    isAcknowledged: false,
    rejectionReason: undefined,
  };
  isDestroyed = false;
  layoutCarryOver: StrandedEditsSource | undefined = undefined;
  readonly options: CollabClientOptions;
  #remote: PresenceSnapshot = new Map();
  readonly #statusListeners = new Set<CollabStatusListener>();
  readonly #presenceListeners = new Set<PresenceListener>();
  readonly presence: BoardSyncClient['presence'];

  constructor(options: CollabClientOptions, hasPresence = true, role: BoardTokenRole = 'editor') {
    this.options = options;
    this.claims = { principalId: 'guest-7', principalType: 'user', boardId: 'board-1', role };
    this.presence = hasPresence
      ? {
          getRemote: (): PresenceSnapshot => this.#remote,
          subscribe: (listener: PresenceListener): (() => void) => {
            this.#presenceListeners.add(listener);
            return () => this.#presenceListeners.delete(listener);
          },
        }
      : undefined;
  }

  subscribe(listener: CollabStatusListener): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  destroy(): void {
    this.isDestroyed = true;
  }

  moveTo(state: ConnectionState): void {
    this.status = { ...this.status, state };
    for (const listener of this.#statusListeners) listener(this.status);
  }

  /**
   * Gives the client the relay's answer for its token, as `onAuthenticated` does.
   *
   * @param isReadOnly - Whether the relay refuses this client's updates.
   */
  answer(isReadOnly: boolean): void {
    this.status = { ...this.status, isReadOnly };
    for (const listener of this.#statusListeners) listener(this.status);
  }

  showRemote(states: readonly PresenceState[]): void {
    this.#remote = new Map(states.map((state, index) => [index + 10, state]));
    for (const listener of this.#presenceListeners) listener(this.#remote);
  }
}
