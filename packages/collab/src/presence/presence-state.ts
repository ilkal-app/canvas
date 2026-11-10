// The presence types: what each client broadcasts on the Yjs
// awareness channel. Presence is transient by construction: it lives in awareness, never in the
// board's Y.Doc, so it is never persisted.

/**
 * The principal kinds that appear in presence: people, agents, and guests
 * who joined by link without an account, shown as people.
 */
export const PRINCIPAL_KINDS = ['user', 'agent', 'guest'] as const;

/** Whether a principal is a person, an agent or a guest. */
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/** Who a client is, as collaborators see it next to its cursor and selection. */
export interface PresencePrincipal {
  /** The user's or agent's id; the same id the relay's board token carries as `sub`. */
  readonly id: string;
  /** Whether the principal is a person or an agent. */
  readonly kind: PrincipalKind;
  /** The display name drawn beside the cursor. */
  readonly name: string;
  /** The cursor and selection colour, `#rrggbb`. */
  readonly color: string;
  /**
   * For an agent, the id of the user who operates it (the board token's `operatorId`, without
   * `user:`), as the relay stamps it from the token; absent for a person, from a relay
   * that stamps none, and from the local state. The operator's clients record the agent's
   * writes in their undo history (`writersOperatedBy`).
   */
  readonly operatorId?: string;
}

/** A pointer position, in world units. */
export interface PresenceCursor {
  /** Horizontal position, in world units. */
  readonly x: number;
  /** Vertical position, in world units. */
  readonly y: number;
}

/** The region of the board a client's screen shows. */
export interface PresenceViewport {
  /** Left edge of the visible region, in world units. */
  readonly x: number;
  /** Top edge of the visible region, in world units. */
  readonly y: number;
  /** Width of the visible region, in world units; positive. */
  readonly w: number;
  /** Height of the visible region, in world units; positive. */
  readonly h: number;
  /** The camera zoom factor, in screen pixels per world unit; positive. */
  readonly zoom: number;
}

/**
 * The text a client is editing: the object whose text it is, and the caret or selection
 * in it as UTF-16 offsets into that text (the editor's positions). `anchor` is the selection's
 * fixed end and `focus` its moving end, where the caret is; equal for a collapsed caret.
 * Presence carries it only: the document never holds it.
 */
export interface PresenceEditing {
  /** The edited object's id: 1 to 64 letters, digits, `_` or `-`, an object on the board. */
  readonly objectId: string;
  /** The selection's fixed end, a UTF-16 offset: a non-negative integer. */
  readonly anchor: number;
  /** The selection's moving end, where the caret is, a UTF-16 offset: a non-negative integer. */
  readonly focus: number;
}

/**
 * A spotlight the client shares: everyone else on the board follows it until they opt
 * out or it ends; the newest one wins (`activeSpotlight`).
 */
export interface PresenceSpotlight {
  /** When it started, in ms on the sender's clock: a finite number above 0. */
  readonly startedAt: number;
}

/**
 * One client's presence: who it is, and where its cursor, selection and viewport are. Every
 * field but the principal is optional: an agent with no pointer has no cursor, and a client
 * that has not laid out its canvas yet has no viewport.
 */
export interface PresenceState {
  /** Who the client is. */
  readonly principal: PresencePrincipal;
  /** The pointer position, absent while the pointer is off the canvas. */
  readonly cursor?: PresenceCursor;
  /**
   * The selected objects' ids. A plain string until `@canvas/schema` defines an object id type;
   * then this becomes that type.
   */
  readonly selection?: readonly string[];
  /** The region the client's screen shows. */
  readonly viewport?: PresenceViewport;
  /**
   * The page the client shows: its cursor, selection and viewport
   * are on that page. Absent from a client of a build without pages, which shows the first page.
   */
  readonly page?: string;
  /**
   * The text the client is editing and its caret or selection; absent while it edits
   * none. A remote claim on an object the board does not hold is dropped.
   */
  readonly editing?: PresenceEditing;
  /**
   * The spotlight the client shares, absent when none. A viewer's or commenter's is
   * dropped by the relay.
   */
  readonly spotlight?: PresenceSpotlight;
  /**
   * Whom the client follows: their principal id, which outlives
   * a reconnection as an awareness client id does not; absent while it follows nobody. A
   * spotlighter counts their followers from it.
   */
  readonly following?: string;
  /** When the sender last changed this state, in ms on the sender's clock; informative only. */
  readonly updatedAt: number;
}

/**
 * What the relay adds to a remote presence state, beside the {@link PresenceState}
 * fields a client sets: `writerClientIds`, the Yjs client ids the relay vouches the client wrote
 * with, from the updates it applied for the client's connection, and `isNameSigned`. Never set by a client (the
 * relay replaces whatever one sends, and the local state never carries it); absent from a state
 * no relay stamped (an older relay, a local board). Read it with `writerClientIdsOf`.
 */
export interface WriterStampedPresence {
  /** The Yjs client ids, each once, at most 16. */
  readonly writerClientIds?: readonly number[];
  /**
   * Whether `principal.name` is the token's signed display name. When it is not, the client
   * chose the name, so only `principal.id` may name the writer.
   */
  readonly isNameSigned?: boolean;
}

/** A client's awareness id: the Yjs client id of its document. */
export type PresenceClientId = number;

/** Every remote client's presence, by awareness client id; a new map whenever anything changes. */
export type PresenceSnapshot = ReadonlyMap<PresenceClientId, PresenceState>;

/**
 * A change to the local presence: a field that is present replaces the current value, `null`
 * clears it, and an absent field keeps it.
 */
export interface PresenceUpdate {
  /** The new pointer position, or `null` when the pointer leaves the canvas. */
  readonly cursor?: PresenceCursor | null;
  /** The new selection, or `null` when nothing is selected. */
  readonly selection?: readonly string[] | null;
  /** The new visible region, or `null` to stop sharing it. */
  readonly viewport?: PresenceViewport | null;
  /** The page now shown, or `null` to stop sharing it. */
  readonly page?: string | null;
  /** The text now edited and its caret or selection, or `null` when editing ends. */
  readonly editing?: PresenceEditing | null;
  /** The spotlight now shared, or `null` to end it. */
  readonly spotlight?: PresenceSpotlight | null;
  /** Whom the client now follows, a principal id, or `null` when it stops. */
  readonly following?: string | null;
}
