import type { ConnectionState } from '@canvas/collab';
import { YjsDocumentStore } from '@canvas/document';

import { LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';
import type { BoardConnectionStatus } from '../board-connection-status.js';
import type { BoardConnection } from '../board-connection.js';

/**
 * A board connection whose state a test sets: a real, empty store; a status that changes when
 * told (`setState`); a count of `destroy` calls; the relay's 4403 close as the collab client
 * handles it (`closeForAccessChange`), over the page's token provider.
 */
export class FakeBoardConnection implements BoardConnection {
  readonly store = new YjsDocumentStore();
  readonly origin = LOCAL_USER_ORIGIN;
  destroyCount = 0;
  #status: BoardConnectionStatus;
  readonly #listeners = new Set<() => void>();
  readonly #requestToken: (() => Promise<string>) | undefined;
  /** Whether the relay withholds its acknowledgement of what the connection holds. */
  #isAcknowledgementHeld: boolean;

  /**
   * Starts connected.
   *
   * @param boardId - The board.
   * @param requestToken - The page's token provider, which the collab client asks.
   * @param isReadOnly - Whether the person's token is a viewer's.
   * @param isAcknowledgementHeld - Whether the relay has not yet acknowledged what the connection
   *   holds (edits restored from the device in its step 2): `isAcknowledged` stays false.
   */
  constructor(
    boardId: string,
    requestToken?: () => Promise<string>,
    isReadOnly = false,
    isAcknowledgementHeld = false,
  ) {
    this.#requestToken = requestToken;
    this.#isAcknowledgementHeld = isAcknowledgementHeld;
    this.#status = {
      boardId,
      state: 'connected',
      isLocalOnly: false,
      isSavedOnDevice: false,
      pendingUpdateCount: 0,
      isAcknowledged: !isAcknowledgementHeld,
      isReadOnly,
      rejectionReason: undefined,
      collaborators: [],
      strandedEdits: [],
    };
  }

  status(): BoardConnectionStatus {
    return this.#status;
  }

  dismissStrandedEdits(): void {
    // The site's tests strand nothing.
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.destroyCount += 1;
  }

  /**
   * Changes the state and tells the listeners, as the collab client does, in the same task.
   *
   * @param state - The new state.
   * @param rejectionReason - The relay's reason, for `unauthorized`.
   */
  setState(state: ConnectionState, rejectionReason?: string): void {
    this.#change({ state, rejectionReason });
  }

  /**
   * Gives the relay's answer for a new token: a role changed while the board is open.
   *
   * @param isReadOnly - Whether the person may now only view the board.
   */
  setReadOnly(isReadOnly: boolean): void {
    this.#change({ isReadOnly });
  }

  /**
   * Counts local edits the relay has not acknowledged, as the collab client does.
   *
   * @param pendingUpdateCount - How many.
   */
  setPendingUpdateCount(pendingUpdateCount: number): void {
    this.#change({ pendingUpdateCount });
  }

  /**
   * Says whether the device's cache is open for the connection (`isSavedOnDevice`).
   *
   * @param isSavedOnDevice - Whether it is.
   */
  setSavedOnDevice(isSavedOnDevice: boolean): void {
    this.#change({ isSavedOnDevice });
  }

  /**
   * Withholds or gives the relay's acknowledgement of what the connection holds.
   *
   * @param isHeld - Whether it is withheld.
   */
  holdAcknowledgement(isHeld: boolean): void {
    this.#isAcknowledgementHeld = isHeld;
    this.#change({});
  }

  /**
   * Changes the status and tells the listeners; `isAcknowledged` follows as the collab client's
   * does: connected, nothing pending, and the relay's acknowledgement not withheld.
   *
   * @param change - The fields to change.
   */
  #change(change: Partial<BoardConnectionStatus>): void {
    const next = { ...this.#status, ...change };
    this.#status = {
      ...next,
      isAcknowledged:
        next.state === 'connected' && next.pendingUpdateCount === 0 && !this.#isAcknowledgementHeld,
    };
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * How many listeners are subscribed.
   *
   * @returns The count.
   */
  get listenerCount(): number {
    return this.#listeners.size;
  }

  /**
   * Asks the page's token provider for a token, as the collab client does for each attempt.
   *
   * @returns The token.
   */
  requestToken(): Promise<string> {
    return this.#requestToken === undefined
      ? Promise.reject(new Error('The fake connection has no token provider.'))
      : this.#requestToken();
  }

  /**
   * The relay closes the connection with 4403 `access-changed` (the owner removed the person or
   * changed their role), handled as the collab client does: it leaves `connected`, telling the
   * listeners in the same task, then asks for a token for its next attempt.
   *
   * @returns When the token request settled.
   */
  async closeForAccessChange(): Promise<void> {
    this.setState('reconnecting', 'access-changed');
    await this.requestToken().catch(() => undefined);
  }
}
