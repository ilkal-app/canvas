import { BOARD_BOUND } from '../fields/board-bound.js';
import { ID_PATTERN } from '../ids/object-id.js';

// Reactions on the wire: a person drops an emoji on the board and everyone on it sees it
// float up and fade. A reaction is an event, never board content: it travels as a stateless
// message through the relay, which stamps who sent it and fans it out to the board's other
// connections (never back to the sender's), and nothing stores it. The client sends
// `{ type: "reaction", emoji, x, y, pageId }`; the relay broadcasts the same with `from`, the
// sender's principal, which only the relay writes.
// Pure: both sides parse strictly and treat anything else as not theirs.

/** The emoji a person can drop, in the flyout's order (the design board's Whiteboard page). */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '👀', '🙌', '🤔', '😂'] as const;

/** One of {@link REACTION_EMOJIS}. */
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** A reaction as a person sends it. */
export interface ReactionDrop {
  /** The emoji. */
  readonly emoji: ReactionEmoji;
  /** Where on the board across, in board units, within the board's bound. */
  readonly x: number;
  /** Where on the board down, in board units, within the board's bound. */
  readonly y: number;
  /** The page it was dropped on. */
  readonly pageId: string;
}

/** A reaction as the relay fans it out: the drop and who sent it. */
export interface ReactionEvent extends ReactionDrop {
  /** The sender's principal id, as the relay knows it from their token. */
  readonly from: string;
}

/**
 * Parses a stateless payload as a JSON object with exactly the given keys and `type`.
 *
 * @param payload - The payload.
 * @param keys - The keys it must have, `type` among them.
 * @returns The object, or undefined.
 */
function parseExact(
  payload: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const own = Object.keys(record);
  const isExact = own.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
  return isExact && record.type === 'reaction' ? record : undefined;
}

/**
 * Reads a drop's fields from a parsed record.
 *
 * @param record - The record.
 * @returns The drop, or undefined when a field is out of its rules.
 */
function dropOf(record: Readonly<Record<string, unknown>>): ReactionDrop | undefined {
  const { emoji, x, y, pageId } = record;
  const isCoordinate = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= BOARD_BOUND;
  const isEmoji = (REACTION_EMOJIS as readonly unknown[]).includes(emoji);
  const isPage = typeof pageId === 'string' && ID_PATTERN.test(pageId);
  if (!isEmoji || !isCoordinate(x) || !isCoordinate(y) || !isPage) return undefined;
  return { emoji: emoji as ReactionEmoji, x, y, pageId };
}

const DROP_KEYS = ['type', 'emoji', 'x', 'y', 'pageId'] as const;

/**
 * Encodes a person's drop.
 *
 * @param drop - The drop.
 * @returns The stateless payload.
 * @throws {RangeError} When the drop breaks the rules {@link parseReactionDrop} applies.
 */
export function encodeReactionDrop(drop: ReactionDrop): string {
  const payload = JSON.stringify({ type: 'reaction', ...drop });
  if (parseReactionDrop(payload) === undefined) throw new RangeError('not a valid reaction');
  return payload;
}

/**
 * Reads a client's stateless payload as a drop: exactly `type`, `emoji` (one of
 * {@link REACTION_EMOJIS}), finite `x` and `y` within the board's bound, and a page id. A
 * `from` a client writes is refused: only the relay names the sender.
 *
 * @param payload - The payload, already bounded by the relay's stateless frame limit.
 * @returns The drop, or undefined for anything else.
 */
export function parseReactionDrop(payload: string): ReactionDrop | undefined {
  const record = parseExact(payload, DROP_KEYS);
  return record === undefined ? undefined : dropOf(record);
}

/**
 * Encodes the relay's fan-out of a drop.
 *
 * @param event - The drop and its sender.
 * @returns The stateless payload.
 */
export function encodeReactionEvent(event: ReactionEvent): string {
  const { emoji, x, y, pageId, from } = event;
  return JSON.stringify({ type: 'reaction', emoji, x, y, pageId, from });
}

/**
 * Reads the relay's stateless payload as a reaction: a drop and a non-empty `from` of at most
 * 256 characters.
 *
 * @param payload - The payload.
 * @returns The event, or undefined for anything else.
 */
export function parseReactionEvent(payload: string): ReactionEvent | undefined {
  const record = parseExact(payload, [...DROP_KEYS, 'from']);
  const drop = record === undefined ? undefined : dropOf(record);
  const from = record?.from;
  const isFrom = typeof from === 'string' && from.length > 0 && from.length <= 256;
  return drop === undefined || !isFrom ? undefined : { ...drop, from };
}
