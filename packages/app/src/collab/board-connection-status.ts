import {
  colorForPrincipal,
  type ConnectionState,
  type PresenceEditing,
  type PresenceSnapshot,
  type PrincipalKind,
  type StrandedEdits,
} from '@canvas/collab';

/** A collaborator on the board, as presence shows them. */
export interface CollaboratorSummary {
  /** Their principal id: their token's `sub`. */
  readonly principalId: string;
  /** Person or agent. */
  readonly kind: PrincipalKind;
  /** Their display name; their principal id when they have none. */
  readonly name: string;
  /** Their presence colour, `#rrggbb`: the one their cursor and avatar show. */
  readonly color: string;
  /** The page they show, when their presence says. */
  readonly page?: string;
  /**
   * The text they are editing and their caret or selection in it, when their presence
   * says; only on an object this board holds.
   */
  readonly editing?: PresenceEditing;
}

/** Where the shell's board stands with the relay, as the presence/share bar shows it: plain data. */
export interface BoardConnectionStatus {
  /** The board. */
  readonly boardId: string;
  /** The connection state; `offline` for a local-only board. */
  readonly state: ConnectionState;
  /**
   * Whether the board is only on this device: no relay was configured, or none answered when the
   * page opened (the shell then shows the demo board locally and does not retry).
   */
  readonly isLocalOnly: boolean;
  /**
   * Whether the board is kept on this device (its IndexedDB cache opened), so edits made while
   * no relay answers survive a reload; `false` in private browsing or where IndexedDB is blocked,
   * when the board lives only in the page's memory.
   */
  readonly isSavedOnDevice: boolean;
  /** Local updates the relay has not acknowledged yet. */
  readonly pendingUpdateCount: number;
  /**
   * Whether the relay has acknowledged everything this connection holds (the collab client's
   * `isAcknowledged`,'s notion): connected, and its step 2, which carries edits restored
   * from the device (never counted in `pendingUpdateCount`), and every update since, taken by the
   * relay. Always false for a local-only board.
   */
  readonly isAcknowledged: boolean;
  /**
   * Whether the person may only look at the board (a viewer or a commenter): the
   * relay's answer for the connection's latest token once it has answered (a role changed while
   * the board is open shows here when the relay re-admits the person), and the first
   * token's role before that (offline, or still connecting). The shell turns editing off while it
   * is true. Always false for a local-only board.
   */
  readonly isReadOnly: boolean;
  /**
   * Why the client stopped for good, once `state` is `unauthorized` (the relay's token reason)
   * or `outdated` (the layout gate's reason, or the store's version problem).
   */
  readonly rejectionReason: string | undefined;
  /**
   * The board's lock past its owner's plan, from the token: the owner's board limit,
   * which the view-only notice names; absent on an editable board.
   */
  readonly planLock?: {
    /** The owner's board limit. */
    readonly boards: number;
  };
  /** Every other client on the board, one entry per client, sorted by principal id. */
  readonly collaborators: readonly CollaboratorSummary[];
  /**
   * Edits an earlier stored layout's build cached for this board that could not be carried
   * over a layout bump, kept on the device until the person dismisses them; empty
   * almost always.
   */
  readonly strandedEdits: readonly StrandedEdits[];
}

/** The stranded edits of a board without any: one frozen empty list. */
export const NO_STRANDED_EDITS: readonly StrandedEdits[] = Object.freeze([]);

/**
 * The collaborators of a presence snapshot, one per client, sorted by principal id then name,
 * each with their presence colour: their colourway's dark, which this client derives from their id
 * (`colorForPrincipal`) rather than taking the colour their client sent, so every view
 * and every client version shows a person in one colour.
 *
 * @param snapshot - The remote presence.
 * @returns The collaborators; a new array.
 */
export function collaboratorsOf(snapshot: PresenceSnapshot): CollaboratorSummary[] {
  return [...snapshot.values()]
    .map(({ principal, page, editing }) => ({
      principalId: principal.id,
      kind: principal.kind,
      // Presence shortens and cleans a name, which can leave nothing: show who they are instead.
      name: principal.name === '' ? principal.id : principal.name,
      color: colorForPrincipal(principal.id),
      ...(page === undefined ? {} : { page }),
      ...(editing === undefined ? {} : { editing }),
    }))
    .sort(
      (first, second) =>
        first.principalId.localeCompare(second.principalId) ||
        first.name.localeCompare(second.name),
    );
}
