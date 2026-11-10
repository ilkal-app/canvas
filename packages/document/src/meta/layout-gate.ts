import type * as Y from 'yjs';

import { DOCUMENT_META_KEY, META_MAP_NAME, DOCUMENT_LAYOUT_VERSION } from './document-meta.js';
import { highestLayoutStamp } from './layout-history.js';

// The relay's layout version gate: a client says which stored layouts it reads
// (`layout-declaration.ts`), the board says which one it holds (its metadata stamp),
// and the relay refuses a client that cannot read the board before any of the board's data is
// sent. There is no migration: a refused client is an old build, and reloading the app fixes it.

/**
 * The first stored layout the gate knows: 1, the grouped layout of and the first one a
 * document is stamped with. A client that declares nothing reads only layouts below it, which no
 * stamped board holds, so it is refused on every board anyone has written to.
 */
export const FIRST_GATED_LAYOUT_VERSION = 1;

/**
 * The WebSocket close code of the gate's refusal: 4426, the private-use range (RFC 6455 §7.4.2)
 * plus HTTP's 426 Upgrade Required. It is terminal: the client's build cannot read the board, so
 * retrying cannot help; the app must be reloaded.
 */
export const LAYOUT_GATE_CLOSE_CODE = 4426;

/** The close reason when a client cannot read the board's stored layout. */
export const UNREADABLE_LAYOUT_REASON = 'unreadable-layout';

/**
 * The close reason when a client sent objects created by a writer that left no layout stamp
 * (a build from before).
 */
export const UNSTAMPED_WRITE_REASON = 'unstamped-write';

/**
 * The close reason when a client sent a layout stamp the relay refuses: not a stamp this or any
 * build writes (a value that is not an object of two positive whole numbers, or a shared type),
 * or one naming a layout below the board's current one, which would take the board back to a
 * layout its clients may no longer read. Terminal, with {@link LAYOUT_GATE_CLOSE_CODE}.
 */
export const INVALID_STAMP_REASON = 'invalid-stamp';

/** Terminal refusal for plain update values beyond the supported decoder nesting bound. */
export const UPDATE_DEPTH_REASON = 'update-depth-exceeded';

/**
 * Terminal refusal of a read-only connection's update whose bytes the relay's scan cannot read
 * within their length: the relay closes it rather than hand the bytes to a decoder.
 * An honest client never sends such bytes. A writer's unreadable update is retried instead
 * ({@link INCOMPLETE_UPDATE_REASON}).
 */
export const UPDATE_MALFORMED_REASON = 'update-malformed';

/**
 * The WebSocket close code of an update the relay cannot prove safe yet: 4425, the private-use
 * range plus HTTP's 425 Too Early. The update was not applied. It is not terminal: the client
 * reconnects as after any lost connection, and its next sync carries what the update lacked
 * (typically a writer's earlier structs, stamp included, lost with a dropped message).
 */
export const INCOMPLETE_UPDATE_CLOSE_CODE = 4425;

/** The close reason sent with {@link INCOMPLETE_UPDATE_CLOSE_CODE}. */
export const INCOMPLETE_UPDATE_REASON = 'incomplete-update';

/**
 * The close reason sent with {@link INCOMPLETE_UPDATE_CLOSE_CODE} when a writer's update carries
 * more Yjs clients than `MAX_UPDATE_CLIENTS`. It was not applied; as after any 4425 the
 * client reconnects, and an honest client's next sync carries fewer.
 */
export const TOO_MANY_CLIENTS_REASON = 'too-many-clients';

/**
 * Tells whether a relay's refusal reason is the layout gate's terminal one.
 *
 * @param reason - A close reason or a permission-denied reason.
 * @returns True for {@link UNREADABLE_LAYOUT_REASON}, {@link UNSTAMPED_WRITE_REASON},
 *   {@link INVALID_STAMP_REASON}, {@link UPDATE_DEPTH_REASON} and {@link UPDATE_MALFORMED_REASON};
 *   false for {@link INCOMPLETE_UPDATE_REASON}, which is retried.
 */
export function isLayoutGateReason(reason: string): boolean {
  return (
    reason === UNREADABLE_LAYOUT_REASON ||
    reason === UNSTAMPED_WRITE_REASON ||
    reason === INVALID_STAMP_REASON ||
    reason === UPDATE_DEPTH_REASON ||
    reason === UPDATE_MALFORMED_REASON
  );
}

/** What a board's document says about its stored layout. */
export interface BoardLayout {
  /**
   * Whether anyone ever stamped it: false only for a board nobody has written to, which every
   * client may open, since its first writer's stamp decides its layout.
   */
  readonly isStamped: boolean;
  /**
   * The highest layout in its remaining stamp chain; `undefined` when unstamped, or when the stamp is
   * unreadable or momentarily present only as a deleted item (see `document-version-guard.ts`).
   */
  readonly layoutVersion: number | undefined;
}

/**
 * Reads a board's highest remaining layout stamp, including deleted values before Yjs GC.
 *
 * @param doc - The board's document (the relay's hub, or a store's).
 * @returns Whether it is stamped, and its highest supported remaining layout.
 */
export function readBoardLayout(doc: Y.Doc): BoardLayout {
  const meta = doc.getMap<unknown>(META_MAP_NAME);
  const layoutVersion = highestLayoutStamp(doc)?.layoutVersion;
  return {
    isStamped: meta._map.has(DOCUMENT_META_KEY),
    layoutVersion,
  };
}

/**
 * The gate's rule: whether a client that reads the given layouts may open a board. A board
 * nobody stamped accepts every client. A stamped board accepts a client that reads its layout;
 * when the stamp names none it can read (malformed, or only a deleted stamp for now), it accepts
 * a client that declared any gated layout, whose own store then checks each writer's stamp. A
 * client that declared nothing is refused on every stamped board (fail closed). Pure.
 *
 * @param board - The board's layout (`readBoardLayout`).
 * @param readable - The layouts the client declared (`parseReadableLayouts`).
 * @returns Whether the client may open the board.
 */
export function canReadBoardLayout(board: BoardLayout, readable: readonly number[]): boolean {
  if (!board.isStamped) return true;
  if (board.layoutVersion === undefined) {
    return readable.some((version) => version >= FIRST_GATED_LAYOUT_VERSION);
  }
  return readable.includes(board.layoutVersion);
}

/**
 * Tells whether a value is a positive whole number.
 *
 * @param value - Any value.
 * @returns True for 1, 2, 3 and so on.
 */
function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * The relay's rule for a layout stamp a client writes: an object whose
 * `schemaVersion` and `layoutVersion` are positive whole numbers, and whose layout is not below
 * the board's current one (a board's layout only rises). A newer schema or layout than the
 * relay's own is accepted: the relay does not read objects, and the clients' stores decide what
 * they can read. Pure.
 *
 * @param value - The stamp's value, as the update holds it.
 * @param board - The board's layout before the update (`readBoardLayout`).
 * @returns Whether the relay may apply the stamp.
 */
export function isAcceptableStamp(value: unknown, board: BoardLayout): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { schemaVersion, layoutVersion } = value as Readonly<Record<string, unknown>>;
  if (!isPositiveWholeNumber(schemaVersion) || !isPositiveWholeNumber(layoutVersion)) return false;
  return (
    layoutVersion <= DOCUMENT_LAYOUT_VERSION &&
    (board.layoutVersion === undefined || layoutVersion >= board.layoutVersion)
  );
}
