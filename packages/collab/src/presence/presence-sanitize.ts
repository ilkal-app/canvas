import {
  MAX_PRESENCE_ID_LENGTH,
  MAX_PRESENCE_TEXT_LENGTH,
  MAX_PRESENCE_SELECTION_LENGTH,
  MAX_PRESENCE_WRITER_CLIENT_IDS,
} from './presence-limits.js';
import { cleanPresenceName } from './presence-names.js';
import type { PresencePrincipal, PresenceState, WriterStampedPresence } from './presence-state.js';
import { isValidFollowing, isValidSpotlight } from './presence-validation.js';

/** The cleaned form of each remote state the channel has cleaned, by the state it came from. */
const CLEANED = new WeakMap<object, PresenceState>();

/**
 * A remote selection as presence keeps it: the ids that are empty or longer than an object id
 * are dropped, and only the first {@link MAX_PRESENCE_SELECTION_LENGTH} ids are kept.
 *
 * @param selection - The selection the peer sent, a list of strings.
 * @returns The ids to keep.
 */
function cleanSelection(selection: readonly string[]): string[] {
  const kept: string[] = [];
  for (const id of selection) {
    if (id.length === 0 || id.length > MAX_PRESENCE_ID_LENGTH) continue;
    kept.push(id);
    if (kept.length === MAX_PRESENCE_SELECTION_LENGTH) break;
  }
  return kept;
}

/** The largest Yjs client id: Yjs draws them as unsigned 32-bit integers. */
const MAX_YJS_CLIENT_ID = 2 ** 32 - 1;

/**
 * A remote state's relay-stamped writer ids as presence keeps them: Yjs client ids,
 * each once, at most {@link MAX_PRESENCE_WRITER_CLIENT_IDS}; anything else in the list is
 * dropped, and a value that is not a list keeps none.
 *
 * @param value - The state's `writerClientIds`.
 * @returns The ids to keep, or undefined when there is no list.
 */
function cleanWriterClientIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: number[] = [];
  for (const id of value as unknown[]) {
    if (kept.length === MAX_PRESENCE_WRITER_CLIENT_IDS) break;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > MAX_YJS_CLIENT_ID) {
      continue;
    }
    if (!kept.includes(id)) kept.push(id);
  }
  return kept;
}

/**
 * A remote principal as presence keeps it: its name cleaned (`cleanPresenceName`), and an
 * operator only on an agent, as a non-empty id no longer than presence ids.
 *
 * @param principal - The principal the peer sent, which passed the guard.
 * @returns The principal to show.
 */
function principalOf(principal: PresencePrincipal): PresencePrincipal {
  const { operatorId, ...rest } = principal as PresencePrincipal & { operatorId?: unknown };
  const isOperated =
    principal.kind === 'agent' &&
    typeof operatorId === 'string' &&
    operatorId.length > 0 &&
    operatorId.length <= MAX_PRESENCE_TEXT_LENGTH;
  return {
    ...rest,
    name: cleanPresenceName(principal.name),
    ...(isOperated ? { operatorId } : {}),
  };
}

/**
 * Cleans a remote presence state that passed the guard: its name loses the characters that can
 * spoof or break a line and is cut to the bound (`cleanPresenceName`), and its selection is
 * filtered and capped, an operator kept only on an agent, its editing claim keeps only its object id and offsets, and its
 * relay stamp keeps only valid writer ids and a boolean `isNameSigned`, and its spotlight
 * only its start time, or nothing when malformed. A peer stays
 * visible with a shortened name; it is not left out for one.
 * The result for one state object is remembered, so an unchanged awareness state gives the same
 * object each time and the snapshot does not change with it.
 *
 * @param state - A state for which `isPresenceState` holds.
 * @returns The state to show.
 */
export function sanitizePresenceState(state: PresenceState): PresenceState {
  const known = CLEANED.get(state);
  if (known !== undefined) return known;
  const { writerClientIds, isNameSigned, spotlight, following, ...rest } = state as PresenceState &
    WriterStampedPresence;
  const writers = cleanWriterClientIds(writerClientIds);
  const cleaned: PresenceState = {
    ...rest,
    principal: principalOf(state.principal),
    ...(state.selection === undefined ? {} : { selection: cleanSelection(state.selection) }),
    ...(state.editing === undefined
      ? {}
      : {
          // Only the three fields: a name, colour or principal a peer tucked in never shows.
          editing: {
            objectId: state.editing.objectId,
            anchor: state.editing.anchor,
            focus: state.editing.focus,
          },
        }),
    // A spotlight keeps only its start; a malformed one is dropped, the peer kept.
    ...(isValidSpotlight(spotlight) ? { spotlight: { startedAt: spotlight.startedAt } } : {}),
    // Whom it follows: a principal id, or nothing when malformed.
    ...(isValidFollowing(following) ? { following } : {}),
    ...(writers === undefined ? {} : { writerClientIds: writers }),
    ...(typeof isNameSigned === 'boolean' ? { isNameSigned } : {}),
  };
  CLEANED.set(state, cleaned);
  return cleaned;
}

/**
 * The Yjs client ids the relay vouches a remote client wrote with (
 * {@link WriterStampedPresence}), as presence kept them.
 *
 * @param state - A remote presence state, from a snapshot.
 * @returns The ids; none when the relay stamped none.
 */
export function writerClientIdsOf(state: PresenceState): readonly number[] {
  return (state as PresenceState & WriterStampedPresence).writerClientIds ?? [];
}
