import { MAX_PRESENCE_ID_LENGTH, MAX_PRESENCE_TEXT_OFFSET } from './presence-limits.js';
import type {
  PresenceCursor,
  PresenceEditing,
  PresenceSpotlight,
  PresenceViewport,
} from './presence-state.js';

/**
 * An object id's text (`@canvas/schema`'s `objectIdSchema`): 1 to 64 letters, digits, `_` or
 * `-`.
 */
const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Whether a value is an object (not null, not an array) whose fields can be read by name.
 *
 * @param value - Any value, typically parsed from a remote awareness message.
 * @returns True when `value` is a plain record.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * Whether a value is a usable cursor: finite world coordinates. Remote cursors are interpolated
 * every frame, so one NaN would poison the overlay pass.
 *
 * @param value - Any value, typically a remote client's `cursor` field.
 * @returns True when `value` is a {@link PresenceCursor}.
 */
export function isValidCursor(value: unknown): value is PresenceCursor {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

/**
 * Whether a value is a usable viewport: finite edges, a positive size in world units and a
 * positive zoom factor. The follow helper divides by the size, so empty regions are refused.
 *
 * @param value - Any value, typically a remote client's `viewport` field.
 * @returns True when `value` is a {@link PresenceViewport}.
 */
export function isValidViewport(value: unknown): value is PresenceViewport {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isPositiveFiniteNumber(value.w) &&
    isPositiveFiniteNumber(value.h) &&
    isPositiveFiniteNumber(value.zoom)
  );
}

/**
 * Whether a value is a usable selection: a list of object ids, each 1 to
 * `MAX_PRESENCE_ID_LENGTH` characters.
 *
 * @param value - Any value, typically a remote client's `selection` field.
 * @returns True when `value` is a list of non-empty strings.
 */
export function isValidSelection(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_PRESENCE_ID_LENGTH,
    )
  );
}

/**
 * Whether a value is a list of strings: what a remote selection must be before the channel
 * drops the ids that are empty or too long and keeps the first
 * `MAX_PRESENCE_SELECTION_LENGTH` (`presence-sanitize.ts`).
 *
 * @param value - Any value, typically a remote client's `selection` field.
 * @returns True when `value` is an array of strings.
 */
export function isSelectionList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

function isTextOffset(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PRESENCE_TEXT_OFFSET
  );
}

/**
 * Whether a value is a usable editing claim: an object id of 1 to
 * `MAX_PRESENCE_ID_LENGTH` letters, digits, `_` or `-`, and two caret offsets that are integers
 * from 0 to `MAX_PRESENCE_TEXT_OFFSET` UTF-16 units. Other keys are allowed here and dropped by
 * the clean-up (`presence-sanitize.ts`), so nothing else a peer adds is ever shown. Whether the
 * object is on the board is the channel's check (`PresenceChannelOptions.objectExists`).
 *
 * @param value - Any value, typically a remote client's `editing` field.
 * @returns True when `value` is a {@link PresenceEditing}.
 */
export function isValidEditing(value: unknown): value is PresenceEditing {
  return (
    isRecord(value) &&
    typeof value.objectId === 'string' &&
    value.objectId.length <= MAX_PRESENCE_ID_LENGTH &&
    OBJECT_ID_PATTERN.test(value.objectId) &&
    isTextOffset(value.anchor) &&
    isTextOffset(value.focus)
  );
}

/**
 * Whether a value is a usable spotlight: a `startedAt` that is a finite number above 0
 * and at most `Number.MAX_SAFE_INTEGER` (ms). Other keys are allowed here and dropped by the
 * clean-up (`presence-sanitize.ts`).
 *
 * @param value - Any value, typically a remote client's `spotlight` field.
 * @returns True when `value` is a {@link PresenceSpotlight}.
 */
export function isValidSpotlight(value: unknown): value is PresenceSpotlight {
  if (!isRecord(value)) return false;
  const { startedAt } = value;
  return (
    typeof startedAt === 'number' &&
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    startedAt <= Number.MAX_SAFE_INTEGER
  );
}

/** The longest principal id `following` carries: the relay's principal bound. */
const MAX_PRESENCE_FOLLOWING_LENGTH = 256;

/**
 * Whether a value names whom a client follows: a principal id of 1 to
 * `MAX_PRESENCE_FOLLOWING_LENGTH` characters.
 *
 * @param value - Any value, typically a remote client's `following` field.
 * @returns True when it is one.
 */
export function isValidFollowing(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_PRESENCE_FOLLOWING_LENGTH
  );
}
