import { isPageIdText } from '@canvas/schema';

import { MAX_PRESENCE_SELECTION_LENGTH } from './presence-limits.js';
import type { PresenceState, PresenceUpdate } from './presence-state.js';
import {
  isValidCursor,
  isValidEditing,
  isValidFollowing,
  isValidSelection,
  isValidSpotlight,
  isValidViewport,
} from './presence-validation.js';

function assertValidUpdate(update: PresenceUpdate): void {
  if (update.cursor != null && !isValidCursor(update.cursor)) {
    throw new RangeError('A presence cursor needs finite x and y, in world units.');
  }
  if (update.viewport != null && !isValidViewport(update.viewport)) {
    throw new RangeError(
      'A presence viewport needs finite x and y and positive w, h (world units) and zoom.',
    );
  }
  if (update.selection != null && !isValidSelection(update.selection)) {
    throw new RangeError('A presence selection is a list of non-empty object ids.');
  }
  if (update.page != null && !isPageIdText(update.page)) {
    throw new RangeError('A presence page is a page id.');
  }
  if (update.editing != null && !isValidEditing(update.editing)) {
    throw new RangeError(
      'A presence editing state needs an object id and integer caret offsets from 0 (UTF-16).',
    );
  }
  if (update.following != null && !isValidFollowing(update.following)) {
    throw new RangeError('A presence following names a principal id of 1 to 256 characters.');
  }
  if (update.spotlight != null && !isValidSpotlight(update.spotlight)) {
    throw new RangeError('A presence spotlight needs a start time above 0, in ms.');
  }
}

/**
 * Merges a change into the local presence: a field the update names replaces the current one,
 * `null` removes it, an absent field is kept. The result never holds an `undefined` key, since
 * awareness sends JSON, and never shares the caller's selection array, of which it keeps the
 * first `MAX_PRESENCE_SELECTION_LENGTH` ids.
 *
 * @param current - The local presence now; not mutated.
 * @param update - The fields to replace or clear.
 * @param updatedAt - The time of the change, in ms on the local clock.
 * @returns A new presence state.
 * @throws {RangeError} When the update's cursor, viewport, selection, page, editing state or
 *   spotlight is malformed, which only a bug in the caller produces.
 */
export function mergePresence(
  current: PresenceState,
  update: PresenceUpdate,
  updatedAt: number,
): PresenceState {
  assertValidUpdate(update);
  const cursor = update.cursor === undefined ? current.cursor : update.cursor;
  const selection = update.selection === undefined ? current.selection : update.selection;
  const viewport = update.viewport === undefined ? current.viewport : update.viewport;
  const page = update.page === undefined ? current.page : update.page;
  const editing = update.editing === undefined ? current.editing : update.editing;
  const spotlight = update.spotlight === undefined ? current.spotlight : update.spotlight;
  const following = update.following === undefined ? current.following : update.following;
  return {
    principal: current.principal,
    ...(cursor == null ? {} : { cursor: { x: cursor.x, y: cursor.y } }),
    ...(selection == null ? {} : { selection: selection.slice(0, MAX_PRESENCE_SELECTION_LENGTH) }),
    ...(viewport == null ? {} : { viewport: { ...viewport } }),
    ...(page == null ? {} : { page }),
    ...(editing == null
      ? {}
      : { editing: { objectId: editing.objectId, anchor: editing.anchor, focus: editing.focus } }),
    ...(spotlight == null ? {} : { spotlight: { startedAt: spotlight.startedAt } }),
    ...(following == null ? {} : { following }),
    updatedAt,
  };
}
